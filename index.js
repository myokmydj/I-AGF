import { extension_settings, getContext } from '../../../extensions.js';
import {
    saveSettingsDebounced,
    eventSource,
    event_types,
    updateMessageBlock,
    getRequestHeaders,
    generateRaw,
    chat,
    substituteParams,
} from '../../../../script.js';
import { appendMediaToMessage } from '../../../../script.js';
import { regexFromString, saveBase64AsFile as stSaveBase64AsFile } from '../../../utils.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { executeSlashCommandsOnChatInput } from '../../../slash-commands.js';
import {
    extensionName,
    extensionFolderPath,
    INSERT_TYPE,
    defaultSettings,
    escapeHtmlAttribute,
    SettingsManager,
    resizeImageForReference,
} from './src/core/index.js';
import {
    PresetsManager,
    VibeTransferManager,
    CharacterRefManager,
    CharacterPromptsManager,
    TagMatchingManager,
    AuxiliaryModelManager,
} from './src/features/index.js';
import { NAIApiClient } from './src/api/index.js';
import { 
    StatusPanelManager, 
    MessageButtonsManager, 
    RegenButtonsManager, 
    DashboardModal,
    initPresetGalleryModal as initPresetGalleryModalModule,
    openPresetGallery as openPresetGalleryModule,
    closePresetGallery as closePresetGalleryModule,
    renderPresetCards as renderPresetCardsModule,
    initRegenModal as initRegenModalModule,
    openRegenModal as openRegenModalModule,
    closeRegenModal as closeRegenModalModule,
} from './src/ui/index.js';

// ============ 모듈화된 컴포넌트 (점진적 마이그레이션) ============
// 아래 모듈들은 새 대시보드 UI에서 사용됩니다.
// 기존 함수들은 호환성을 위해 유지하며, 점진적으로 모듈 버전으로 교체 예정

/* 
 * 모듈 구조:
 * - src/core/: 상수, 유틸리티, 설정 관리
 * - src/features/: 기능별 매니저 클래스
 * - src/api/: NAI API 통신
 * - src/ui/: UI 컴포넌트 및 대시보드
 * - styles/: CSS 스타일시트
 */

let TagMatcher = null;
let tagMatcherReady = false;

let currentNAIStatus = {
    vibeTransfer: null,
    characterReference: null,
    preset: null,
    auxiliaryModel: null,
};

let currentBotName = null;

// Auxiliary model generation state
let isAuxiliaryGenerating = false;

// 모듈러 매니저 인스턴스 보관
let settingsManager = null;
const iagfManagers = {
    presets: null,
    vibeTransfer: null,
    characterRef: null,
    characterPrompts: null,
    tagMatching: null,
    auxiliaryModel: null,
    statusPanel: null,
    messageButtons: null,
    regenButtons: null,
    dashboard: null,
    naiApi: null,
};

// SettingsManager를 통해 설정을 초기화하고 주요 매니저를 준비
initModularManagers();

function initModularManagers() {
    try {
        settingsManager = new SettingsManager(extensionName, extension_settings, saveSettingsDebounced);
        const settings = settingsManager.initialize();

        iagfManagers.presets = new PresetsManager(settings, saveSettingsDebounced, getRequestHeaders);
        iagfManagers.vibeTransfer = new VibeTransferManager(settings, saveSettingsDebounced);
        iagfManagers.characterRef = new CharacterRefManager(settings, saveSettingsDebounced, getCurrentBotName);
        iagfManagers.characterPrompts = new CharacterPromptsManager(settings, saveSettingsDebounced, getCurrentBotName);
        iagfManagers.tagMatching = new TagMatchingManager(settings, saveSettingsDebounced);
        iagfManagers.auxiliaryModel = new AuxiliaryModelManager(settings, saveSettingsDebounced, getContext);

        iagfManagers.naiApi = new NAIApiClient(getRequestHeaders, () => extension_settings.sd || {});

        iagfManagers.statusPanel = new StatusPanelManager(settings, {
            vibeTransfer: iagfManagers.vibeTransfer,
            characterRef: iagfManagers.characterRef,
            characterPrompts: iagfManagers.characterPrompts,
            auxiliaryModel: iagfManagers.auxiliaryModel,
            tagMatching: iagfManagers.tagMatching,
        });

        // UI 매니저들은 DOM 준비 후 초기화 필요
        // initModularUI() 에서 초기화됨

        // 디버깅/테스트 용도로 전역에 노출
        window.iagfManagers = iagfManagers;
    } catch (error) {
        console.error(`[${extensionName}] Failed to initialize modular managers:`, error);
    }
}
// ========== Auxiliary Model Functions ==========

/**
 * Gets available Connection Manager profiles
 * @returns {Array} Array of connection profiles or empty array
 */
function getConnectionProfiles() {
    try {
        const context = getContext();
        const profiles = context.extensionSettings?.connectionManager?.profiles || [];
        return profiles;
    } catch (error) {
        console.error(`[${extensionName}] Error getting connection profiles:`, error);
        return [];
    }
}

/**
 * Sends a request using Connection Manager
 * @param {string} profileId - The Connection Manager profile ID
 * @param {Array<{role: string, content: string}>} messages - Messages to send
 * @param {number} maxTokens - Maximum tokens for response
 * @returns {Promise<string|null>} Response content or null if failed
 */
async function sendConnectionManagerRequest(profileId, messages) {
    const context = getContext();
    
    if (!context.ConnectionManagerRequestService) {
        console.error(`[${extensionName}] ConnectionManagerRequestService not available`);
        toastr.error('Connection Manager가 초기화되지 않았습니다. SillyTavern을 업데이트하세요.', 'IAGF');
        return null;
    }
    
    const profiles = getConnectionProfiles();
    const profile = profiles.find(p => p.id === profileId);
    
    if (!profile) {
        console.error(`[${extensionName}] Profile not found: ${profileId}`);
        toastr.error(`Connection Profile "${profileId}"을(를) 찾을 수 없습니다.`, 'IAGF');
        return null;
    }
    
    if (!profile.api) {
        toastr.error('선택한 프로필에 API가 설정되어 있지 않습니다.', 'IAGF');
        return null;
    }
    
    // Use profile's max_tokens setting
    const maxTokens = profile.max_tokens || undefined;
    
    try {
        console.log(`[${extensionName}] Sending request via Connection Manager:`, {
            profileId: profile.id,
            profileName: profile.name,
            api: profile.api,
            maxTokens: maxTokens || '(profile default)',
            messagesCount: messages.length
        });
        
        const response = await context.ConnectionManagerRequestService.sendRequest(
            profile.id,
            messages,
            maxTokens,
            {}, // custom options
            {}  // override payload
        );
        
        console.log(`[${extensionName}] Connection Manager raw response:`, response);
        
        // Handle various response formats
        if (response) {
            if (typeof response === 'string') {
                console.log(`[${extensionName}] Response is string, length: ${response.length}`);
                return response;
            }
            if (response.content) {
                console.log(`[${extensionName}] Response has content property, length: ${response.content.length}`);
                return response.content;
            }
            if (response.message) {
                console.log(`[${extensionName}] Response has message property`);
                return response.message;
            }
            // Try to stringify if it's an object
            console.warn(`[${extensionName}] Unknown response format:`, typeof response, response);
        }
        
        console.warn(`[${extensionName}] No valid response received`);
        return null;
    } catch (error) {
        console.error(`[${extensionName}] Connection Manager request failed:`, error);
        toastr.error(`보조 모델 요청 실패: ${error.message}`, 'IAGF');
        return null;
    }
}

/**
 * Builds the prompt for auxiliary model to generate image tags
 * @param {string} lastMessage - The last AI message content
 * @returns {Array<{role: string, content: string}>} Message array for generateRaw
 */
function buildAuxiliaryPrompt(lastMessage) {
    const settings = extension_settings[extensionName];
    
    // Get character description and persona
    let description = '';
    let persona = '';
    
    try {
        description = substituteParams('{{description}}') || '';
        persona = substituteParams('{{persona}}') || '';
    } catch (e) {
        console.warn(`[${extensionName}] Error substituting params:`, e);
    }
    
    // Build the prompt with substitutions
    let promptText = settings.auxiliaryModel.prompt || defaultSettings.auxiliaryModel.prompt;
    promptText = promptText.replace(/\{\{description\}\}/g, description);
    promptText = promptText.replace(/\{\{persona\}\}/g, persona);
    promptText = promptText.replace(/\{\{lastMessage\}\}/g, lastMessage);
    
    const messages = [
        {
            role: 'user',
            content: promptText
        }
    ];
    
    return messages;
}

/**
 * Generates image prompt using auxiliary model (Connection Manager profile)
 * @param {string} lastMessage - The last AI message content
 * @returns {Promise<string|null>} Generated prompt text or null if failed
 */
async function generateWithAuxiliaryModel(lastMessage) {
    const settings = extension_settings[extensionName];
    
    if (!settings.auxiliaryModel?.enabled) {
        console.log(`[${extensionName}] Auxiliary model not enabled`);
        return null;
    }
    
    const profileId = settings.auxiliaryModel.connectionProfileId;
    if (!profileId) {
        console.warn(`[${extensionName}] No connection profile selected for auxiliary model`);
        toastr.warning('보조 모델용 Connection Profile을 선택해주세요.', 'IAGF');
        return null;
    }
    
    if (isAuxiliaryGenerating) {
        console.log(`[${extensionName}] Auxiliary model already generating, skipping...`);
        return null;
    }
    
    isAuxiliaryGenerating = true;
    console.log(`[${extensionName}] Starting auxiliary model generation...`);
    
    try {
        // Get profile name for status display
        const profiles = getConnectionProfiles();
        const profile = profiles.find(p => p.id === profileId);
        const profileName = profile?.name || profileId;
        
        console.log(`[${extensionName}] Using profile: ${profileName} (${profileId})`);
        
        // Update status for feedback
        currentNAIStatus.auxiliaryModel = profileName;
        
        // Build prompt and generate
        const promptMessages = buildAuxiliaryPrompt(lastMessage);
        
        console.log(`[${extensionName}] Built prompt messages:`, promptMessages);
        console.log(`[${extensionName}] Generating image prompt with auxiliary model (${profileName})...`);
        toastr.info(`보조 모델(${profileName})로 이미지 프롬프트 생성 중...`, 'IAGF', { timeOut: 2000 });
        
        const response = await sendConnectionManagerRequest(profileId, promptMessages);
        
        console.log(`[${extensionName}] sendConnectionManagerRequest returned:`, response ? `string length ${response.length}` : 'null');
        
        if (response) {
            console.log(`[${extensionName}] Auxiliary model response (first 500 chars):`, response.substring(0, 500));
            return response;
        }
        
        console.warn(`[${extensionName}] Auxiliary model returned null/empty response`);
        return null;
    } catch (error) {
        console.error(`[${extensionName}] Error generating with auxiliary model:`, error);
        toastr.error(`보조 모델 생성 오류: ${error.message}`, 'IAGF');
        return null;
    } finally {
        isAuxiliaryGenerating = false;
        currentNAIStatus.auxiliaryModel = null;
    }
}

/**
 * Extracts image prompts from auxiliary model response
 * @param {string} response - The auxiliary model response
 * @returns {Array<string>} Array of extracted prompts
 */
function extractPromptsFromAuxiliaryResponse(response) {
    const settings = extension_settings[extensionName];
    const regex = regexFromString(settings.promptInjection.regex);
    
    let matches;
    if (regex.global) {
        matches = [...response.matchAll(regex)];
    } else {
        const singleMatch = response.match(regex);
        matches = singleMatch ? [singleMatch] : [];
    }
    
    return matches.map(match => match[1]).filter(prompt => prompt && prompt.trim());
}

// ========== End Auxiliary Model Functions ==========

function generateImageId() {
    return 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = (error) => reject(error);
    });
}

function chooseReferenceResolution(width, height) {
    const ratio = width / height;
    if (ratio >= 0.9 && ratio <= 1.1) {
        return { canvasWidth: 1472, canvasHeight: 1472 };
    } else if (ratio < 1) {
        return { canvasWidth: 1024, canvasHeight: 1536 };
    } else {
        return { canvasWidth: 1536, canvasHeight: 1024 };
    }
}

function stripBase64Header(base64Data) {
    if (base64Data.includes(',')) {
        return base64Data.split(',')[1];
    }
    return base64Data;
}

function updateToggleButtonUI() {
    const isEnabled = extension_settings[extensionName].insertType !== INSERT_TYPE.DISABLED;
    $('#iagf_toggle').toggleClass('selected', isEnabled);
    $('#iagf_toggle span').text(isEnabled ? 'IAGF Enabled' : 'IAGF Disabled');
    const icon = $('#iagf_toggle > div');
    icon.removeClass('fa-power-off fa-check');
    icon.addClass(isEnabled ? 'fa-check' : 'fa-power-off');
}

// Preset Gallery - 모듈 사용
function initPresetGalleryModal() {
    initPresetGalleryModalModule();
}

function openPresetGallery() {
    const settings = extension_settings[extensionName];
    openPresetGalleryModule(settings, handlePresetSelect, handleGeneratePreview);
}

function closePresetGallery() {
    closePresetGalleryModule();
}

function handlePresetSelect(presetKey) {
    const settings = extension_settings[extensionName];
    settings.currentPreset = presetKey;
    saveSettingsDebounced();
    updateStatusPanel();
    toastr.success(`Preset "${settings.presets[presetKey]?.name || presetKey}" activated`);
}

async function handleGeneratePreview(presetKey) {
    const settings = extension_settings[extensionName];
    const preset = settings.presets[presetKey];
    if (!preset) return;
    
    const samplePrompt = 'a beautiful anime girl with long flowing hair, detailed eyes, soft lighting, portrait';
    const finalPrompt = ((preset.prefixPrompt || '') + ' ' + samplePrompt + ' ' + (preset.suffixPrompt || '')).trim();
    const negativePrompt = preset.negativePrompt || '';
    
    // NAIApiClient 모듈 사용
    if (iagfManagers.naiApi) {
        const imageData = await iagfManagers.naiApi.generatePreview(finalPrompt, negativePrompt);
        if (imageData) {
            preset.previewImage = imageData.startsWith('data:') ? imageData : 'data:image/png;base64,' + imageData;
            saveSettingsDebounced();
            toastr.success('Preview generated!');
        }
    } else {
        throw new Error('NAI API client not initialized');
    }
}

function onToggleExtension() {
    const settings = extension_settings[extensionName];
    if (settings.insertType === INSERT_TYPE.DISABLED) {
        settings.insertType = INSERT_TYPE.INLINE;
    } else {
        settings.insertType = INSERT_TYPE.DISABLED;
    }
    saveSettingsDebounced();
    updateUI();
    updateToggleButtonUI();
}

function updateUI() {
    // 확장 메뉴 상태 업데이트
    $('#auto_generation').toggleClass(
        'selected',
        extension_settings[extensionName].insertType !== INSERT_TYPE.DISABLED,
    );
    updateToggleButtonUI();
    updateStatusPanel();
}

// 현재 봇의 캐릭터 레퍼런스 데이터 가져오기
function getCurrentBotCharacterReferences() {
    const settings = extension_settings[extensionName];
    const botName = getCurrentBotName();
    
    if (!botName || !settings.characterReference?.perBot) {
        return null;
    }
    
    return settings.characterReference.perBot[botName] || null;
}

// 현재 봇의 캐릭터 레퍼런스 데이터 설정
function setCurrentBotCharacterReferences(data) {
    const settings = extension_settings[extensionName];
    const botName = getCurrentBotName();
    
    if (!botName) {
        return;
    }
    
    if (!settings.characterReference) {
        settings.characterReference = defaultSettings.characterReference;
    }
    if (!settings.characterReference.perBot) {
        settings.characterReference.perBot = {};
    }
    
    settings.characterReference.perBot[botName] = data;
    saveSettingsDebounced();
}

// 봇 데이터 초기화
function initBotCharacterRefData() {
    return {
        characters: {},        // { charName: { images: [], activeImageId, fidelity, styleAware } }
        activeCharacter: null, // 현재 활성화된 캐릭터 이름
    };
}

// 캐릭터 추가
function addCharacterToBot(charName) {
    const botName = getCurrentBotName();
    if (!botName || !charName) return false;
    
    let botData = getCurrentBotCharacterReferences();
    if (!botData || !botData.characters) {
        botData = initBotCharacterRefData();
    }
    
    if (botData.characters[charName]) {
        toastr.warning('이미 존재하는 캐릭터입니다');
        return false;
    }
    
    botData.characters[charName] = {
        images: [],
        activeImageId: null,
        fidelity: extension_settings[extensionName].characterReference.defaultFidelity,
        styleAware: extension_settings[extensionName].characterReference.defaultStyleAware,
    };
    
    setCurrentBotCharacterReferences(botData);
    return true;
}

// 캐릭터에 이미지 추가
function addImageToCharacter(charName, imageData, imageName) {
    const botData = getCurrentBotCharacterReferences();
    if (!botData || !botData.characters || !botData.characters[charName]) return null;
    
    const id = generateImageId();
    const newImage = {
        id: id,
        data: imageData,
        name: imageName,
    };
    
    botData.characters[charName].images.push(newImage);
    
    // 첫 이미지면 자동 선택
    if (botData.characters[charName].images.length === 1) {
        botData.characters[charName].activeImageId = id;
    }
    
    setCurrentBotCharacterReferences(botData);
    return newImage;
}

// 현재 선택된 봇(캐릭터) 이름 가져오기
function getCurrentBotName() {
    try {
        const context = getContext();
        if (context && context.characters && context.characterId !== undefined) {
            const char = context.characters[context.characterId];
            if (char && char.name) {
                return char.name;
            }
        }
        // 그룹 채팅인 경우
        if (context && context.groupId) {
            return `group_${context.groupId}`;
        }
    } catch (e) {
    }
    return null;
}

// 캐릭터 프롬프트 ID 생성
function generateCharacterPromptId() {
    return 'char_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// 현재 봇의 캐릭터 프롬프트 가져오기
function getCurrentBotCharacterPrompts() {
    const settings = extension_settings[extensionName];
    const botName = getCurrentBotName();
    
    if (!botName || !settings.characterPrompts?.perBot) {
        return [];
    }
    
    const botData = settings.characterPrompts.perBot[botName];
    return botData?.characters || [];
}

// 현재 봇의 캐릭터 프롬프트 저장
function setCurrentBotCharacterPrompts(characters) {
    const settings = extension_settings[extensionName];
    const botName = getCurrentBotName();
    
    if (!botName) {
        return;
    }
    
    if (!settings.characterPrompts) {
        settings.characterPrompts = defaultSettings.characterPrompts;
    }
    if (!settings.characterPrompts.perBot) {
        settings.characterPrompts.perBot = {};
    }
    
    settings.characterPrompts.perBot[botName] = {
        characters: characters,
    };
    
    saveSettingsDebounced();
}

async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};

    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], JSON.parse(JSON.stringify(defaultSettings)));
    } else {
        if (!extension_settings[extensionName].promptInjection) {
            extension_settings[extensionName].promptInjection =
                JSON.parse(JSON.stringify(defaultSettings.promptInjection));
        } else {
            const defaultPromptInjection = defaultSettings.promptInjection;
            for (const key in defaultPromptInjection) {
                // undefined, null, 빈 문자열 모두 기본값으로 대체 (prompt, regex 등 필수 문자열 필드)
                const currentValue = extension_settings[extensionName].promptInjection[key];
                const isEmptyString = typeof defaultPromptInjection[key] === 'string' && currentValue === '';
                if (currentValue === undefined || currentValue === null || isEmptyString) {
                    extension_settings[extensionName].promptInjection[key] =
                        defaultPromptInjection[key];
                }
            }
        }

        if (extension_settings[extensionName].insertType === undefined) {
            extension_settings[extensionName].insertType =
                defaultSettings.insertType;
        }

        if (!extension_settings[extensionName].presets) {
            extension_settings[extensionName].presets = JSON.parse(JSON.stringify(defaultSettings.presets));
        }
        if (!extension_settings[extensionName].currentPreset) {
            extension_settings[extensionName].currentPreset = defaultSettings.currentPreset;
        }

        if (!extension_settings[extensionName].vibeTransfer) {
            extension_settings[extensionName].vibeTransfer = JSON.parse(JSON.stringify(defaultSettings.vibeTransfer));
        } else {
            for (const key in defaultSettings.vibeTransfer) {
                const currentValue = extension_settings[extensionName].vibeTransfer[key];
                if (currentValue === undefined || currentValue === null) {
                    extension_settings[extensionName].vibeTransfer[key] = defaultSettings.vibeTransfer[key];
                }
            }
        }

        if (!extension_settings[extensionName].characterReference) {
            extension_settings[extensionName].characterReference = JSON.parse(JSON.stringify(defaultSettings.characterReference));
        } else {
            for (const key in defaultSettings.characterReference) {
                const currentValue = extension_settings[extensionName].characterReference[key];
                if (currentValue === undefined || currentValue === null) {
                    extension_settings[extensionName].characterReference[key] = defaultSettings.characterReference[key];
                }
            }
            // perBot 구조 초기화 확인
            if (!extension_settings[extensionName].characterReference.perBot) {
                extension_settings[extensionName].characterReference.perBot = {};
            }
        }

        if (!extension_settings[extensionName].tagMatching) {
            extension_settings[extensionName].tagMatching = JSON.parse(JSON.stringify(defaultSettings.tagMatching));
        } else {
            for (const key in defaultSettings.tagMatching) {
                const currentValue = extension_settings[extensionName].tagMatching[key];
                if (currentValue === undefined || currentValue === null) {
                    extension_settings[extensionName].tagMatching[key] = defaultSettings.tagMatching[key];
                }
            }
        }

        if (!extension_settings[extensionName].characterPrompts) {
            extension_settings[extensionName].characterPrompts = JSON.parse(JSON.stringify(defaultSettings.characterPrompts));
        } else {
            for (const key in defaultSettings.characterPrompts) {
                const currentValue = extension_settings[extensionName].characterPrompts[key];
                if (currentValue === undefined || currentValue === null) {
                    extension_settings[extensionName].characterPrompts[key] = defaultSettings.characterPrompts[key];
                }
            }
        }

        // messageActionPrompt 초기화
        if (!extension_settings[extensionName].messageActionPrompt) {
            extension_settings[extensionName].messageActionPrompt = JSON.parse(JSON.stringify(defaultSettings.messageActionPrompt));
        } else {
            for (const key in defaultSettings.messageActionPrompt) {
                const currentValue = extension_settings[extensionName].messageActionPrompt[key];
                const isEmptyString = typeof defaultSettings.messageActionPrompt[key] === 'string' && currentValue === '';
                if (currentValue === undefined || currentValue === null || isEmptyString) {
                    extension_settings[extensionName].messageActionPrompt[key] = defaultSettings.messageActionPrompt[key];
                }
            }
        }

        // auxiliaryModel 초기화
        if (!extension_settings[extensionName].auxiliaryModel) {
            extension_settings[extensionName].auxiliaryModel = JSON.parse(JSON.stringify(defaultSettings.auxiliaryModel));
        } else {
            for (const key in defaultSettings.auxiliaryModel) {
                const currentValue = extension_settings[extensionName].auxiliaryModel[key];
                const isEmptyString = typeof defaultSettings.auxiliaryModel[key] === 'string' && currentValue === '';
                // prompt 필드는 빈 문자열일 때도 기본값으로 대체
                if (currentValue === undefined || currentValue === null || (key === 'prompt' && isEmptyString)) {
                    extension_settings[extensionName].auxiliaryModel[key] = defaultSettings.auxiliaryModel[key];
                }
            }
        }
    }

    // 현재 봇 이름 초기화
    currentBotName = getCurrentBotName();

    // 태그 매처 초기화
    await initializeTagMatcher();

    updateUI();
}

async function createSettings(settingsHtml) {
    if (!$('#image_auto_generation_container').length) {
        $('#extensions_settings2').append(
            '<div id="image_auto_generation_container" class="extension_container"></div>',
        );
    }

    $('#image_auto_generation_container').empty().append(settingsHtml);

    // Dashboard 버튼 핸들러 - 이제 유일한 설정 패널 기능
    $('#iagf_open_dashboard').on('click', function () {
        openDashboard();
    });
}

// 태그 매처 초기화
async function initializeTagMatcher() {
    const settings = extension_settings[extensionName];
    
    // 태그 매칭이 비활성화되어 있으면 로드하지 않음
    if (!settings.tagMatching?.enabled) {
        console.log(`[${extensionName}] Tag matching disabled, skipping initialization`);
        return;
    }

    try {
        // 동적으로 tag-matcher.js 로드
        if (!TagMatcher) {
            console.log(`[${extensionName}] Loading tag-matcher.js...`);
            const script = document.createElement('script');
            script.src = `${extensionFolderPath}/tag-matcher.js?v=20260102d`;
            
            await new Promise((resolve, reject) => {
                script.onload = () => {
                    resolve();
                };
                script.onerror = (e) => {
                    reject(e);
                };
                document.head.appendChild(script);
            });

            TagMatcher = window.TagMatcher;
        }

        if (TagMatcher && !TagMatcher.isReady()) {
            const tagsUrl = `${extensionFolderPath}/tags.json`;
            const result = await TagMatcher.initialize(tagsUrl);
            tagMatcherReady = TagMatcher.isReady();
        } else if (TagMatcher && TagMatcher.isReady()) {
            tagMatcherReady = true;
        }
    } catch (error) {
        tagMatcherReady = false;
    }
}

function applyTagMatching(prompt) {
    const settings = extension_settings[extensionName];
    
    if (!settings.tagMatching?.enabled || !tagMatcherReady || !TagMatcher) {
        return { prompt, matched: false };
    }

    try {
        const result = TagMatcher.processPrompt(prompt, {
            useFuzzyBest: settings.tagMatching.useFuzzyBest,
            keepUnmatched: settings.tagMatching.keepUnmatched,
        });

        return {
            prompt: result.prompt,
            matched: true,
            original: result.original,
            stats: result.stats,
            results: result.results,
        };
    } catch (error) {
        return { prompt, matched: false, error };
    }
}

function applyPresetToPrompt(prompt) {
    const settings = extension_settings[extensionName];
    const currentPreset = settings.presets[settings.currentPreset];

    const tagMatchResult = applyTagMatching(prompt);
    let finalPrompt = tagMatchResult.prompt;

    if (!currentPreset) return finalPrompt;

    if (currentPreset.prefixPrompt && currentPreset.prefixPrompt.trim()) {
        finalPrompt = currentPreset.prefixPrompt.trim() + ', ' + finalPrompt;
    }

    if (currentPreset.suffixPrompt && currentPreset.suffixPrompt.trim()) {
        finalPrompt = finalPrompt + ', ' + currentPreset.suffixPrompt.trim();
    }

    return finalPrompt;
}

function getNAIExtraParams(prompt) {
    const settings = extension_settings[extensionName];
    const extraParams = {};

    currentNAIStatus = {
        vibeTransfer: null,
        vibeTransferActive: false,
        characterReference: null,
        characterReferenceImage: null,
        preset: settings.currentPreset,
    };

    // Vibe Transfer via manager (fallback to legacy)
    const vibeExtra = iagfManagers.vibeTransfer?.getExtraParams?.();
    if (vibeExtra) {
        extraParams.vibeTransfer = vibeExtra;
        const vibeStatus = iagfManagers.vibeTransfer.getStatus();
        currentNAIStatus.vibeTransfer = vibeStatus.imageName || vibeStatus.text;
        currentNAIStatus.vibeTransferActive = !!vibeStatus.active;
    } else if (settings.vibeTransfer.enabled && settings.vibeTransfer.selectedImageId) {
        const vibeImage = settings.vibeTransfer.images[settings.vibeTransfer.selectedImageId];
        if (vibeImage && vibeImage.active !== false) {
            extraParams.vibeTransfer = {
                image: vibeImage.data,
                strength: settings.vibeTransfer.defaultStrength,
                infoExtracted: settings.vibeTransfer.defaultInfoExtracted,
            };
            currentNAIStatus.vibeTransfer = vibeImage.name;
            currentNAIStatus.vibeTransferActive = true;
        }
    }

    // Character Reference via manager (fallback to legacy)
    const charRefExtra = iagfManagers.characterRef?.getExtraParams?.();
    if (charRefExtra) {
        extraParams.characterReference = charRefExtra;
        currentNAIStatus.characterReference = charRefExtra.characterName;
        currentNAIStatus.characterReferenceImage = (charRefExtra.images?.length && '1 image') || null;
    } else if (settings.characterReference?.enabled) {
        const botData = getCurrentBotCharacterReferences();
        if (botData && botData.activeCharacter) {
            const charData = botData.characters[botData.activeCharacter];
            if (charData && charData.activeImageId) {
                const activeImage = charData.images.find(img => img.id === charData.activeImageId);
                if (activeImage && activeImage.data) {
                    extraParams.characterReference = {
                        characterName: botData.activeCharacter,
                        images: [activeImage.data],
                        fidelity: charData.fidelity ?? settings.characterReference.defaultFidelity,
                        styleAware: charData.styleAware ?? settings.characterReference.defaultStyleAware,
                    };
                    currentNAIStatus.characterReference = botData.activeCharacter;
                    currentNAIStatus.characterReferenceImage = activeImage.name;
                }
            }
        }
    }

    // Negative prompt from preset
    const currentPreset = iagfManagers.presets?.getCurrentPreset?.() || settings.presets[settings.currentPreset];
    if (currentPreset?.negativePrompt) {
        extraParams.negativePrompt = currentPreset.negativePrompt;
    }

    // Character prompts via manager (fallback to legacy)
    const charPromptsExtra = iagfManagers.characterPrompts?.getExtraParams?.();
    if (charPromptsExtra?.characterPrompts?.length) {
        extraParams.characterPrompts = charPromptsExtra.characterPrompts;
        extraParams.characterPositionEnabled = !!charPromptsExtra.positionEnabled;
        currentNAIStatus.characterPrompts = charPromptsExtra.characterPrompts.length;
    } else if (settings.characterPrompts?.enabled === true) {
        try {
            const charPrompts = getCurrentBotCharacterPrompts();
            if (Array.isArray(charPrompts)) {
                const enabledCharPrompts = charPrompts.filter(c => c && c.enabled === true && c.prompt && c.prompt.trim());
                if (enabledCharPrompts.length > 0) {
                    extraParams.characterPrompts = enabledCharPrompts.map(c => ({
                        prompt: c.prompt,
                        negative: c.negative || '',
                        enabled: true,
                        position: c.position || { x: 0.5, y: 0.5 },
                    }));
                    extraParams.characterPositionEnabled = settings.characterPrompts.positionEnabled || false;
                    currentNAIStatus.characterPrompts = enabledCharPrompts.length;
                }
            }
        } catch (e) {
        }
    }

    return extraParams;
}

function updateStatusPanel() {
    const statusPanel = iagfManagers.statusPanel;
    if (statusPanel?.update) {
        statusPanel.update();
    }
}

function showNAIStatusFeedback(extraParams) {
    const statusParts = [];
    
    $('#nai_status_indicator')
        .removeClass('active inactive')
        .addClass('generating');
    
    if (currentNAIStatus.preset && currentNAIStatus.preset !== 'default') {
        const settings = extension_settings[extensionName];
        const presetName = settings.presets[currentNAIStatus.preset]?.name || currentNAIStatus.preset;
        statusParts.push(`🎨 Preset: ${presetName}`);
    }
    
    if (currentNAIStatus.vibeTransfer) {
        statusParts.push(`🎭 Vibe: ${currentNAIStatus.vibeTransfer}`);
    }
    
    if (currentNAIStatus.characterReference) {
        statusParts.push(`👤 CharRef: ${currentNAIStatus.characterReference}`);
    }
    
    if (currentNAIStatus.characterPrompts) {
        statusParts.push(`👥 CharPrompts: ${currentNAIStatus.characterPrompts}`);
    }
    
    if (currentNAIStatus.auxiliaryModel) {
        statusParts.push(`🤖 Auxiliary: ${currentNAIStatus.auxiliaryModel}`);
    }
    
    if (extraParams.negativePrompt) {
        statusParts.push(`🚫 Negative prompt applied`);
    }
    
    if (statusParts.length > 0) {
        const statusMessage = statusParts.join(' | ');
        toastr.info(statusMessage, 'NAI Parameters Applied', { timeOut: 3000 });
    }
    
    setTimeout(() => {
        updateStatusPanel();
    }, 3000);
}

async function generateImageWithSD(prompt, extraParams = {}) {
    const settings = extension_settings[extensionName];
    
    showNAIStatusFeedback(extraParams);
    
    const sdSettings = extension_settings.sd || {};
    
    const isNAI = sdSettings.source === 'novel';
    
    if (isNAI && (extraParams.vibeTransfer || extraParams.characterReference || extraParams.characterPrompts?.length > 0)) {
        return await generateImageWithNAIParams(prompt, extraParams, sdSettings);
    } else {
        const result = await SlashCommandParser.commands['sd'].callback(
            { quiet: 'true' },
            prompt,
        );
        return result;
    }
}

async function generateImageWithNAIParams(prompt, extraParams, sdSettings) {
    try {
        const vibeImages = [];
        const vibeStrengths = [];
        const vibeInfoExtracted = [];
        const charRefImages = [];
        const charRefStrengths = [];
        let charRefStyleAware = false;

        // Ensure UI reflects generating state
        const statusPanel = iagfManagers.statusPanel;
        if (statusPanel?.setGenerating) {
            statusPanel.setGenerating(true);
        } else {
            $('#nai_status_indicator').removeClass('active inactive').addClass('generating');
        }

        // Build vibe transfer payload
        if (extraParams.vibeTransfer?.image) {
            vibeImages.push(extraParams.vibeTransfer.image);
            vibeStrengths.push(extraParams.vibeTransfer.strength ?? 0.7);
            vibeInfoExtracted.push(extraParams.vibeTransfer.infoExtracted ?? false);
        }

        // Build character reference payload
        if (extraParams.characterReference?.images?.length) {
            for (const img of extraParams.characterReference.images) {
                if (!img) continue;
                charRefImages.push(img);
                const fidelityVal = extraParams.characterReference.fidelity ?? 0.5;
                charRefStrengths.push(fidelityVal);
            }
            charRefStyleAware = extraParams.characterReference.styleAware ?? false;
        }

        // Direct NAI call when any NAI-specific params are present
        if (vibeImages.length > 0 || charRefImages.length > 0 || extraParams.characterPrompts?.length > 0) {
            try {
                const result = await callNAIImageGeneration(prompt, extraParams.negativePrompt || '', {
                    vibeImages,
                    vibeStrengths,
                    vibeInfoExtracted,
                    charRefImages,
                    charRefStrengths,
                    charRefStyleAware,
                    characterPrompts: extraParams.characterPrompts || [],
                    characterPositionEnabled: extraParams.characterPositionEnabled || false,
                });
                return result;
            } catch (naiError) {
                toastr.warning('Direct NAI API call failed, falling back to standard SD command');
            }
        }

        // Fallback to standard SD command (temporarily apply negative prompt)
        const originalNegPrompt = sdSettings.negative_prompt;

        if (extraParams.negativePrompt) {
            extension_settings.sd.negative_prompt = extraParams.negativePrompt;
        }

        try {
            if (!SlashCommandParser.commands['sd'] || !SlashCommandParser.commands['sd'].callback) {
                throw new Error('SD command not available. Please ensure the SD extension is enabled.');
            }
            const result = await SlashCommandParser.commands['sd'].callback(
                { quiet: 'true' },
                prompt,
            );
            return result;
        } finally {
            if (originalNegPrompt !== undefined) {
                extension_settings.sd.negative_prompt = originalNegPrompt;
            }
        }
    } catch (error) {
        toastr.error(`NAI generation error: ${error.message}`, 'Error');

        if (!SlashCommandParser.commands['sd'] || !SlashCommandParser.commands['sd'].callback) {
            toastr.error('SD extension not available for fallback', 'Error');
            return null;
        }

        const result = await SlashCommandParser.commands['sd'].callback(
            { quiet: 'true' },
            prompt,
        );
        return result;
    }
}

async function callNAIImageGeneration(prompt, negativePrompt, options = {}) {
    const sdSettings = extension_settings.sd || {};
    
    const model = sdSettings.model || 'nai-diffusion-4-5-full';
    const sampler = sdSettings.sampler || 'k_euler_ancestral';
    const scheduler = sdSettings.scheduler || 'native';
    const steps = Math.min(sdSettings.steps || 28, 50);
    const scale = parseFloat(sdSettings.scale) || 5.0;
    const width = parseInt(sdSettings.width) || 832;
    const height = parseInt(sdSettings.height) || 1216;
    const seed = sdSettings.seed >= 0 ? sdSettings.seed : Math.floor(Math.random() * 2147483647);
    
    const vibeImages = options.vibeImages || [];
    const vibeStrengths = (options.vibeStrengths || []).map(v => {
        const floatVal = parseFloat(v);
        return Number.isInteger(floatVal) ? floatVal + 0.0001 : floatVal;
    });
    const vibeInfoExtracted = (options.vibeInfoExtracted || vibeImages.map(() => 1.0)).map(v => {
        const floatVal = parseFloat(v);
        return Number.isInteger(floatVal) ? floatVal + 0.0001 : floatVal;
    });
    
    const charRefImages = options.charRefImages || [];
    const charRefStrengths = (options.charRefStrengths || []).map(v => {
        const floatVal = parseFloat(v);
        return Number.isInteger(floatVal) ? floatVal + 0.0001 : floatVal;
    });
    const charRefStyleAware = options.charRefStyleAware || false;
    
    const characterPrompts = options.characterPrompts || [];
    const characterPositionEnabled = options.characterPositionEnabled || false;
    
    const requestBody = {
        input: prompt,
        model: model,
        action: 'generate',
        parameters: {
            params_version: 3,
            width: width,
            height: height,
            noise_schedule: scheduler,
            controlnet_strength: 1,
            dynamic_thresholding: false,
            scale: scale,
            sampler: sampler,
            steps: steps,
            seed: seed,
            n_samples: 1,
            ucPreset: 0,
            negative_prompt: negativePrompt,
            qualityToggle: true,
            use_coords: false,
            legacy: false,
            legacy_v3_extend: false,
            prefer_brownian: true,
            autoSmea: false,
            v4_prompt: {
                caption: {
                    base_caption: prompt,
                    char_captions: [],
                },
                use_coords: false,
                use_order: true,
            },
            v4_negative_prompt: {
                caption: {
                    base_caption: negativePrompt,
                    char_captions: [],
                },
                legacy_uc: false,
            },
        },
    };
    
    if (vibeImages.length > 0) {
        requestBody.parameters.reference_image_multiple = vibeImages.map(img => stripBase64Header(img));
        requestBody.parameters.reference_strength_multiple = vibeStrengths;
        requestBody.parameters.reference_information_extracted_multiple = vibeInfoExtracted;
    }
    
    if (charRefImages.length > 0) {
        const processedCharRefImages = [];
        for (const img of charRefImages) {
            const resized = await resizeImageForReference(img, 'image/jpeg');
            processedCharRefImages.push(stripBase64Header(resized));
        }
        requestBody.parameters.director_reference_images = processedCharRefImages;
        requestBody.parameters.director_reference_strength_values = charRefImages.map(() => 1.0);
        requestBody.parameters.director_reference_information_extracted = charRefImages.map(() => 1.0);
        requestBody.parameters.director_reference_secondary_strength_values = charRefStrengths.map(s => 1.0 - s);
        const charRefCaption = charRefStyleAware ? 'character&style' : 'character';
        requestBody.parameters.director_reference_descriptions = charRefImages.map(() => ({
            caption: {
                base_caption: charRefCaption,
                char_captions: [],
            },
            legacy_uc: false,
        }));
    }
    
    if (characterPrompts.length > 0) {
        for (const char of characterPrompts) {
            if (char.prompt && char.prompt.trim()) {
                requestBody.parameters.v4_prompt.caption.char_captions.push({
                    char_caption: char.prompt,
                    centers: characterPositionEnabled
                        ? [{ x: char.position?.x || 0.5, y: char.position?.y || 0.5 }]
                        : [{ x: 0.5, y: 0.5 }]
                });
                if (char.negative && char.negative.trim()) {
                    requestBody.parameters.v4_negative_prompt.caption.char_captions.push({
                        char_caption: char.negative,
                        centers: characterPositionEnabled
                            ? [{ x: char.position?.x || 0.5, y: char.position?.y || 0.5 }]
                            : [{ x: 0.5, y: 0.5 }]
                    });
                }
            }
        }
        if (requestBody.parameters.v4_prompt.caption.char_captions.length > 0 && characterPositionEnabled) {
            requestBody.parameters.v4_prompt.use_coords = true;
            requestBody.parameters.v4_negative_prompt.use_coords = true;
            requestBody.parameters.use_coords = true;
        }
    }
    
    let response;
    let usedPlugin = false;
    
    try {
        response = await fetch('/api/plugins/nai-reference-image/generate', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(requestBody),
        });
        usedPlugin = true;
    } catch (pluginError) {
    }
    
    if (!usedPlugin || response.status === 404) {
        return await callNAIImageGenerationFallback(prompt, negativePrompt, options);
    }
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`NAI API error: ${response.status} - ${errorText}`);
    }
    
    const imageData = await response.text();
    
    if (!imageData) {
        throw new Error('NAI API returned empty response');
    }
    
    const filename = `nai_${Date.now()}`;
    const base64Image = saveBase64AsFile(imageData, 'nai_generated', filename, 'png');
    
    return base64Image;
}

async function callNAIImageGenerationFallback(prompt, negativePrompt, options = {}) {
    const sdSettings = extension_settings.sd || {};
    
    const model = sdSettings.model || 'nai-diffusion-4-5-full';
    const sampler = sdSettings.sampler || 'k_euler_ancestral';
    const scheduler = sdSettings.scheduler || 'native';
    const steps = Math.min(sdSettings.steps || 28, 50);
    const scale = parseFloat(sdSettings.scale) || 5.0;
    const width = parseInt(sdSettings.width) || 832;
    const height = parseInt(sdSettings.height) || 1216;
    const seed = sdSettings.seed >= 0 ? sdSettings.seed : Math.floor(Math.random() * 2147483647);
    
    const requestBody = {
        prompt: prompt,
        model: model,
        sampler: sampler,
        scheduler: scheduler,
        steps: steps,
        scale: scale,
        width: width,
        height: height,
        negative_prompt: negativePrompt,
        seed: seed,
    };
    
    const response = await fetch('/api/novelai/generate-image', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`NAI API error: ${response.status} - ${errorText}`);
    }
    
    const imageData = await response.text();
    
    if (!imageData) {
        throw new Error('NAI API returned empty response');
    }
    
    const filename = `nai_${Date.now()}`;
    const base64Image = saveBase64AsFile(imageData, 'nai_generated', filename, 'png');
    
    return base64Image;
}

function saveBase64AsFile(base64Data, folder, filename, format) {
    if (base64Data.startsWith('data:')) {
        return base64Data;
    }
    return `data:image/${format};base64,${base64Data}`;
}

$(function () {
    (async function () {
        try {
            const settingsHtml = await $.get(
                `${extensionFolderPath}/settings.html`,
            );

            $('#extensionsMenu')
                .append(`<div id="auto_generation" class="list-group-item flex-container flexGap5">
                <div class="fa-solid fa-robot"></div>
                <span data-i18n="IAGF">IAGF</span>
            </div>
            <div id="iagf_toggle" class="list-group-item flex-container flexGap5" title="Toggle IAGF Extension">
                <div class="fa-solid fa-power-off"></div>
                <span>IAGF Enable/Disable</span>
            </div>
            <div id="iagf_preset_gallery" class="list-group-item flex-container flexGap5" title="Preset Gallery">
                <div class="fa-solid fa-images"></div>
                <span>IAGF Preset Gallery</span>
            </div>`);

            $('#auto_generation').off('click').on('click', openDashboard);
            $('#iagf_toggle').off('click').on('click', onToggleExtension);
            $('#iagf_preset_gallery').off('click').on('click', openPresetGallery);
            updateToggleButtonUI();
            initPresetGalleryModal();

            await loadSettings();

            await createSettings(settingsHtml);

            if (eventSource && event_types) {
                eventSource.on(event_types.CHAT_CHANGED, () => {
                    const newBotName = getCurrentBotName();
                    if (newBotName !== currentBotName) {
                        currentBotName = newBotName;
                        updateStatusPanel();
                    }
                });
            }

            SlashCommandParser.addCommandObject({
            name: 'sdnai',
            aliases: [],
            callback: async (args, prompt) => {
                const finalPrompt = applyPresetToPrompt(prompt);
                const extraParams = getNAIExtraParams(prompt);

                const result = await SlashCommandParser.commands['sd'].callback(
                    args,
                    finalPrompt,
                );

                return result;
            },
            helpString: 'Generate image with NAI character reference and vibe transfer support',
        });

        addMessageImageButton();
        } catch (initError) {
            console.error(`[${extensionName}] Initialization error:`, initError);
        }
    })();
});

function addMessageImageButton() {
    // 외부 CSS 파일 로드
    if (!$('#iagf_mes_button_style').length) {
        const cssLink = document.createElement('link');
        cssLink.id = 'iagf_mes_button_style';
        cssLink.rel = 'stylesheet';
        cssLink.href = `${extensionFolderPath}/styles/message-buttons.css`;
        document.head.appendChild(cssLink);
    }

    function addButtonToMessage(mesElement) {
        const $mes = $(mesElement);
        let extraMesButtons = $mes.find('.extraMesButtons');

        if (!extraMesButtons.length) {
            const mesButtons = $mes.find('.mes_buttons');
            if (mesButtons.length) {
                mesButtons.append('<div class="extraMesButtons"></div>');
                extraMesButtons = $mes.find('.extraMesButtons');
            }
        }

        if (!extraMesButtons.length || extraMesButtons.find('.iagf_img_btn').length) {
            return;
        }

        const $button = $(
            '<div title="Generate Image from Message" class="mes_button iagf_img_btn fa-solid fa-panorama interactable" tabindex="0" role="button"></div>',
        );

        // 클릭 이벤트 바인딩
        $button.on('click', async function(e) {
            e.stopPropagation();
            e.preventDefault();
            
            console.log(`[${extensionName}] Message button clicked`);
            
            // 이미 생성 중이면 무시
            if ($(this).hasClass('generating')) {
                console.log(`[${extensionName}] Already generating, ignoring click`);
                return;
            }

            // 버튼 상태 변경
            $(this).addClass('generating');
            
            try {
                const mesId = $mes.attr('mesid');
                console.log(`[${extensionName}] Getting message for mesId: ${mesId}`);
                
                const context = getContext();
                if (!context || !context.chat) {
                    toastr.error('Chat context not available');
                    return;
                }
                
                const message = context.chat[mesId];
                
                if (!message) {
                    toastr.error('Message not found');
                    return;
                }
                
                console.log(`[${extensionName}] Message found, processing...`);
                // 메시지 내용 가져오기
                let messageContent = message.mes;
                
                // 먼저 <pic prompt="..."> 태그가 이미 있는지 확인
                const imgTagRegex = regexFromString(
                    extension_settings[extensionName].promptInjection.regex
                );
                const existingMatches = messageContent.match(imgTagRegex);
                let extractedPrompt = null;
                
                if (existingMatches && existingMatches[1]) {
                    // 이미 pic 태그가 있으면 그 프롬프트 사용
                    extractedPrompt = existingMatches[1];
                } else {
                    // pic 태그가 없으면 AI에게 프롬프트 생성 요청
                    toastr.info('Generating prompt from message...', 'IAGF');
                    
                    // HTML 태그 제거하고 메시지 내용 정리
                    let cleanContent = messageContent.replace(/<[^>]*>/g, ' ');
                    cleanContent = cleanContent.replace(/\s+/g, ' ').trim();
                    
                    // 사용자 설정 가져오기
                    const settings = extension_settings[extensionName];
                    const messageMaxLength = settings.messageActionPrompt?.messageMaxLength ?? defaultSettings.messageActionPrompt.messageMaxLength;
                    
                    // 메시지가 너무 길면 자르기 (0 = 무제한)
                    if (messageMaxLength > 0 && cleanContent.length > messageMaxLength) {
                        cleanContent = cleanContent.substring(0, messageMaxLength);
                    }
                    
                    if (!cleanContent) {
                        toastr.warning('Message content is empty');
                        return;
                    }
                    
                    // 사용자 설정 프롬프트 템플릿 가져오기
                    const promptTemplate = settings.messageActionPrompt?.prompt || defaultSettings.messageActionPrompt.prompt;
                    const maxResponseLength = settings.messageActionPrompt?.maxResponseLength || defaultSettings.messageActionPrompt.maxResponseLength;
                    
                    // 캐릭터 설명과 페르소나 가져오기
                    let characterDescription = '';
                    let userPersona = '';
                    
                    if (context.characters && context.characterId !== undefined) {
                        const char = context.characters[context.characterId];
                        if (char) {
                            characterDescription = char.description || '';
                        }
                    }
                    
                    if (context.name1 && context.personas) {
                        // 현재 선택된 페르소나 찾기
                        const personaName = context.name1;
                        for (const [key, persona] of Object.entries(context.personas || {})) {
                            if (persona.name === personaName || key === personaName) {
                                userPersona = persona.description || '';
                                break;
                            }
                        }
                    }
                    // 대체 방법: persona_description이 있으면 사용
                    if (!userPersona && context.persona_description) {
                        userPersona = context.persona_description;
                    }
                    
                    // AI에게 이미지 프롬프트 생성 요청 (플레이스홀더 대체)
                    let promptGenerationInstruction = promptTemplate
                        .replace(/\{\{message\}\}/g, cleanContent)
                        .replace(/\{\{description\}\}/g, characterDescription || 'No character description available')
                        .replace(/\{\{persona\}\}/g, userPersona || 'No persona description available');
                    
                    try {
                        console.log(`[${extensionName}] Requesting AI prompt generation...`);
                        
                        // genraw 명령이 존재하는지 확인
                        if (!SlashCommandParser.commands['genraw']?.callback) {
                            throw new Error('genraw command not available');
                        }
                        
                        // 타임아웃과 함께 AI 요청 (30초)
                        const timeoutPromise = new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('AI generation timed out')), 30000)
                        );
                        
                        const generationPromise = SlashCommandParser.commands['genraw'].callback(
                            { length: maxResponseLength },
                            promptGenerationInstruction
                        );
                        
                        const generatedText = await Promise.race([generationPromise, timeoutPromise]);
                        console.log(`[${extensionName}] AI response received`);
                        
                        if (generatedText) {
                            // 응답에서 프롬프트 추출 (pic 태그가 있으면 그 안에서, 없으면 전체 텍스트)
                            const picMatch = generatedText.match(/<pic[^>]*\sprompt="([^"]*)"[^>]*?>/);
                            if (picMatch && picMatch[1]) {
                                extractedPrompt = picMatch[1];
                            } else {
                                // pic 태그 없이 직접 프롬프트를 출력한 경우
                                extractedPrompt = generatedText.trim();
                                // 불필요한 텍스트 제거
                                extractedPrompt = extractedPrompt.replace(/^(prompt:|here'?s?|the prompt|image prompt|output:?)/i, '').trim();
                            }
                        } else {
                            throw new Error('Empty response from AI');
                        }
                    } catch (aiError) {
                        console.error(`[${extensionName}] AI prompt generation failed:`, aiError);
                        toastr.warning('AI prompt generation failed, using message content directly');
                        // 폴백: 메시지 내용 직접 사용
                        extractedPrompt = cleanContent.substring(0, 500);
                    }
                }

                if (!extractedPrompt) {
                    toastr.warning('Could not generate prompt');
                    return;
                }

                toastr.info('Generating image...', 'IAGF');
                
                // 프리셋 적용
                const finalPrompt = applyPresetToPrompt(extractedPrompt);
                const extraParams = getNAIExtraParams(extractedPrompt);

                // 이미지 생성
                const result = await generateImageWithSD(finalPrompt, extraParams);
                
                if (result) {
                    // 이미지를 메시지에 삽입
                    if (!message.extra) {
                        message.extra = {};
                    }
                    
                    // 새 media API 사용
                    if (!Array.isArray(message.extra.media)) {
                        message.extra.media = [];
                    }
                    
                    // 새 이미지를 media 배열에 추가 (SillyTavern 형식: url, type, title)
                    message.extra.media.push({ url: result, type: 'image', title: extractedPrompt });
                    message.extra.title = extractedPrompt;
                    message.extra.inline_image = true;
                    
                    // 재생성을 위한 메타데이터 저장
                    const sdSettings = extension_settings.sd || {};
                    message.extra.iagf_gen_params = {
                        prompt: extractedPrompt,
                        finalPrompt: finalPrompt,
                        negativePrompt: extraParams.negativePrompt || sdSettings.negative_prompt || '',
                        width: parseInt(sdSettings.width) || 832,
                        height: parseInt(sdSettings.height) || 1216,
                        steps: Math.min(sdSettings.steps || 28, 50),
                        scale: parseFloat(sdSettings.scale) || 5.0,
                        sampler: sdSettings.sampler || 'k_euler_ancestral',
                        scheduler: sdSettings.scheduler || 'native',
                        seed: Math.floor(Math.random() * 2147483647),
                        model: sdSettings.model || 'nai-diffusion-4-5-full',
                    };
                    
                    // UI 업데이트 - updateMessageBlock 사용하여 완전 갱신
                    updateMessageBlock(mesId, message, { rerenderMessage: false });
                    await context.saveChat();
                    
                    toastr.success('Image generated and added to message!', 'IAGF');
                }
            } catch (error) {
                console.error(`[${extensionName}] Error generating image from message:`, error);
                toastr.error(`Image generation failed: ${error.message}`, 'Error');
            } finally {
                $(this).removeClass('generating');
            }
        });

        extraMesButtons.prepend($button);
    }

    function resetAllButtons() {
        $('#chat > .mes[mesid]').each(function () {
            addButtonToMessage(this);
        });
    }

    function addButtonForMesId(mesId) {
        const message = $(`.mes[mesid="${mesId}"]`);
        if (message.length) {
            addButtonToMessage(message);
        }
    }

    // ST 이벤트 기반으로 버튼 추가
    if (!window.iagfMessageButtonsInitialized) {
        window.iagfMessageButtonsInitialized = true;

        if (eventSource && event_types) {
            if (event_types.CHAT_CHANGED) {
                eventSource.on(event_types.CHAT_CHANGED, () => {
                    setTimeout(resetAllButtons, 100);
                    // 봇 변경 시 상태 업데이트
                    setTimeout(() => {
                        currentBotName = getCurrentBotName();
                        updateStatusPanel();
                    }, 150);
                });
            }

            eventSource.on(event_types.MESSAGE_RECEIVED, (mesId) => {
                if (mesId === undefined || mesId === null) {
                    setTimeout(resetAllButtons, 100);
                    return;
                }
                setTimeout(() => addButtonForMesId(mesId), 100);
            });

            if (event_types.CHARACTER_MESSAGE_RENDERED) {
                eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (mesId) => {
                    setTimeout(() => addButtonForMesId(mesId), 100);
                });
            }

            if (event_types.USER_MESSAGE_RENDERED) {
                eventSource.on(event_types.USER_MESSAGE_RENDERED, (mesId) => {
                    setTimeout(() => addButtonForMesId(mesId), 100);
                });
            }
        }

        // 초기 로드 시 버튼 추가
        setTimeout(resetAllButtons, 500);
    }

    // 초기 메시지들에 버튼 추가
    resetAllButtons();
}

// 获取消息角色
function getMesRole() {
    // 确保对象路径存在
    if (
        !extension_settings[extensionName] ||
        !extension_settings[extensionName].promptInjection ||
        !extension_settings[extensionName].promptInjection.position
    ) {
        return 'system'; // 默认返回system角色
    }

    switch (extension_settings[extensionName].promptInjection.position) {
        case 'deep_system':
            return 'system';
        case 'deep_user':
            return 'user';
        case 'deep_assistant':
            return 'assistant';
        default:
            return 'system';
    }
}

// 监听CHAT_COMPLETION_PROMPT_READY事件以注入提示词
eventSource.on(
    event_types.CHAT_COMPLETION_PROMPT_READY,
    async function (eventData) {
        try {
            const settings = extension_settings[extensionName];
            
            if (
                !settings ||
                !settings.promptInjection ||
                !settings.promptInjection.enabled
            ) {
                return;
            }
            
            if (settings.auxiliaryModel?.enabled) {
                console.log(`[${extensionName}] Auxiliary model enabled, skipping prompt injection`);
                return;
            }

            if (settings.insertType === INSERT_TYPE.DISABLED) {
                settings.insertType = INSERT_TYPE.INLINE;
            }

            const prompt = settings.promptInjection.prompt;
            const depth = settings.promptInjection.depth || 0;
            const role = getMesRole();

            console.log(
                `[${extensionName}] 准备注入提示词: 角色=${role}, 深度=${depth}`,
            );
            console.log(
                `[${extensionName}] 提示词内容: ${prompt.substring(0, 50)}...`,
            );

            // 根据depth参数决定插入位置
            if (depth === 0) {
                // 添加到末尾
                eventData.chat.push({ role: role, content: prompt });
                console.log(`[${extensionName}] 提示词已添加到聊天末尾`);
            } else {
                // 从末尾向前插入
                eventData.chat.splice(-depth, 0, {
                    role: role,
                    content: prompt,
                });
                console.log(
                    `[${extensionName}] 提示词已插入到聊天中，从末尾往前第 ${depth} 个位置`,
                );
            }
        } catch (error) {
            console.error(`[${extensionName}] 提示词注入错误:`, error);
            toastr.error(`提示词注入错误: ${error}`);
        }
    },
);

// 监听消息接收事件
eventSource.on(event_types.MESSAGE_RECEIVED, handleIncomingMessage);
async function handleIncomingMessage(mesId) {
    const settings = extension_settings[extensionName];
    
    if (!settings) {
        return;
    }

    const isInjectionEnabled = settings.promptInjection?.enabled;
    const isAuxiliaryEnabled = settings.auxiliaryModel?.enabled;
    const isInsertDisabled = settings.insertType === INSERT_TYPE.DISABLED;

    if (isInsertDisabled && !isInjectionEnabled && !isAuxiliaryEnabled) {
        return;
    }

    if (isInsertDisabled && (isInjectionEnabled || isAuxiliaryEnabled)) {
        settings.insertType = INSERT_TYPE.INLINE;
    }

    const context = getContext();
    const message = context.chat[context.chat.length - 1];

    if (!message || message.is_user) {
        return;
    }

    if (message.extra?.iagf_processed) {
        return;
    }

    const hasExistingMedia = message.extra?.media && message.extra.media.length > 0;
    if (hasExistingMedia) {
        return;
    }

    if (
        !settings.promptInjection ||
        !settings.promptInjection.regex
    ) {
        console.error('Prompt injection settings not properly initialized');
        return;
    }

    message.extra = message.extra || {};
    message.extra.iagf_processed = true;

    const imgTagRegex = regexFromString(settings.promptInjection.regex);
    let matches;
    if (imgTagRegex.global) {
        matches = [...message.mes.matchAll(imgTagRegex)];
    } else {
        const singleMatch = message.mes.match(imgTagRegex);
        matches = singleMatch ? [singleMatch] : [];
    }
    
    console.log(`[${extensionName}] Regex matches:`, matches.length);
    
    // ========== Auxiliary Model Mode ==========
    // If no matches found and auxiliary model is enabled, generate prompts separately
    if (matches.length === 0 && settings.auxiliaryModel?.enabled) {
        console.log(`[${extensionName}] No image tags found, checking auxiliary model settings...`);
        console.log(`[${extensionName}] auxiliaryModel.enabled:`, settings.auxiliaryModel.enabled);
        console.log(`[${extensionName}] auxiliaryModel.connectionProfileId:`, settings.auxiliaryModel.connectionProfileId);
        
        setTimeout(async () => {
            try {
                console.log(`[${extensionName}] Starting auxiliary model flow...`);
                toastr.info('Generating image prompt with auxiliary model...', 'IAGF');
                
                // Generate prompts using auxiliary model
                const auxResponse = await generateWithAuxiliaryModel(message.mes);
                
                console.log(`[${extensionName}] generateWithAuxiliaryModel returned:`, auxResponse ? `response length ${auxResponse.length}` : 'null/undefined');
                
                if (!auxResponse) {
                    console.log(`[${extensionName}] Auxiliary model returned no response`);
                    toastr.warning('보조 모델 응답이 없습니다.', 'IAGF');
                    return;
                }
                
                console.log(`[${extensionName}] Auxiliary response preview:`, auxResponse.substring(0, 300));
                
                // Extract prompts from auxiliary response
                const extractedPrompts = extractPromptsFromAuxiliaryResponse(auxResponse);
                
                console.log(`[${extensionName}] extractPromptsFromAuxiliaryResponse returned:`, extractedPrompts);
                
                if (extractedPrompts.length === 0) {
                    console.log(`[${extensionName}] No prompts extracted from auxiliary response`);
                    console.log(`[${extensionName}] Regex used:`, settings.promptInjection.regex);
                    toastr.warning('보조 모델 응답에서 이미지 프롬프트를 추출하지 못했습니다. 응답 형식을 확인하세요.', 'IAGF');
                    return;
                }
                
                console.log(`[${extensionName}] Extracted ${extractedPrompts.length} prompts from auxiliary model:`, extractedPrompts);
                toastr.info(`Generating ${extractedPrompts.length} images...`, 'IAGF');
                
                // Process extracted prompts
                await processImageGeneration(message, context, extractedPrompts);
                
            } catch (error) {
                console.error(`[${extensionName}] Error in auxiliary model generation:`, error);
                toastr.error(`Auxiliary model error: ${error.message}`, 'IAGF');
            }
        }, 100);
        
        return;
    }
    // ========== End Auxiliary Model Mode ==========
    
    if (matches.length > 0) {
        // 延迟执行图片生成，确保消息首先显示出来
        setTimeout(async () => {
            try {
                toastr.info(`Generating ${matches.length} images...`);
                const prompts = matches.map(match => typeof match?.[1] === 'string' ? match[1] : '').filter(p => p.trim());
                await processImageGeneration(message, context, prompts);
            } catch (error) {
                console.error(`[${extensionName}] Error in image generation:`, error);
                toastr.error(`Image generation error: ${error.message}`, 'IAGF');
            }
        }, 0);
    }
}

/**
 * Process image generation for extracted prompts
 * @param {Object} message - The chat message object
 * @param {Object} context - The SillyTavern context
 * @param {Array<string>} prompts - Array of prompts to generate images for
 */
async function processImageGeneration(message, context, prompts) {
    const settings = extension_settings[extensionName];
    const insertType = settings.insertType;

    // 初始化message.extra
    if (!message.extra) {
        message.extra = {};
    }

    // 새 media API 사용
    if (!Array.isArray(message.extra.media)) {
        message.extra.media = [];
    }

    // 获取消息元素用于稍后更新
    const mesId = context.chat.length - 1;
    const messageElement = $(`.mes[mesid="${mesId}"]`);

    // 处理每个提取的图片提示
    for (const prompt of prompts) {
        if (!prompt.trim()) {
            continue;
        }

        // 프리셋 적용
        const finalPrompt = applyPresetToPrompt(prompt);
        const extraParams = getNAIExtraParams(prompt);

        console.log(`[${extensionName}] Generating image:`, {
            originalPrompt: prompt,
            finalPrompt,
            extraParams,
        });

        // NAI 파라미터를 포함한 이미지 생성
        let result;
        if (insertType === INSERT_TYPE.NEW_MESSAGE) {
            // 새 메시지로 삽입하는 경우 기본 SD 명령 사용
            result = await SlashCommandParser.commands['sd'].callback(
                { quiet: 'false' },
                finalPrompt,
            );
        } else {
            // NAI 파라미터를 포함한 이미지 생성
            result = await generateImageWithSD(finalPrompt, extraParams);
        }
        
        // 统一插入到extra里
        if (insertType === INSERT_TYPE.INLINE || insertType === INSERT_TYPE.REPLACE) {
            let imageUrl = result;
            if (
                typeof imageUrl === 'string' &&
                imageUrl.trim().length > 0
            ) {
                // 새 이미지를 media 배열에 추가 (SillyTavern 형식: url, type, title)
                message.extra.media.push({ url: imageUrl, type: 'image', title: prompt });
                message.extra.title = prompt;
                message.extra.inline_image = true;
                
                // 재생성을 위한 메타데이터 저장
                const sdSettings = extension_settings.sd || {};
                message.extra.iagf_gen_params = {
                    prompt: prompt,
                    finalPrompt: finalPrompt,
                    negativePrompt: extraParams.negativePrompt || sdSettings.negative_prompt || '',
                    width: parseInt(sdSettings.width) || 832,
                    height: parseInt(sdSettings.height) || 1216,
                    steps: Math.min(sdSettings.steps || 28, 50),
                    scale: parseFloat(sdSettings.scale) || 5.0,
                    sampler: sdSettings.sampler || 'k_euler_ancestral',
                    scheduler: sdSettings.scheduler || 'native',
                    seed: Math.floor(Math.random() * 2147483647),
                    model: sdSettings.model || 'nai-diffusion-4-5-full',
                };

                // UI 업데이트 - updateMessageBlock 사용하여 완전 갱신
                updateMessageBlock(mesId, message, { rerenderMessage: false });

                // 保存聊天记录
                await context.saveChat();
            }
        }
    }
    
    toastr.success(`${prompts.length} images generated successfully`, 'IAGF');
}

// NAI API 직접 호출을 위한 함수 (향후 확장용)
async function generateImageWithNAI(prompt, options = {}) {
    const settings = extension_settings[extensionName];

    // NAI API 엔드포인트
    const NAI_API_URL = 'https://image.novelai.net/ai/generate-image';

    // 기본 파라미터
    const params = {
        input: prompt,
        model: 'nai-diffusion-3', // 또는 다른 모델
        action: 'generate',
        parameters: {
            width: options.width || 832,
            height: options.height || 1216,
            scale: options.scale || 5,
            sampler: options.sampler || 'k_euler',
            steps: options.steps || 28,
            seed: options.seed || Math.floor(Math.random() * 2147483647),
            n_samples: 1,
            ucPreset: 0,
            qualityToggle: true,
            sm: false,
            sm_dyn: false,
            dynamic_thresholding: false,
            controlnet_strength: 1,
            legacy: false,
            add_original_image: true,
            cfg_rescale: 0,
            noise_schedule: 'native',
        },
    };

    // Vibe Transfer 추가
    if (options.vibeTransfer) {
        params.parameters.reference_image_multiple = [
            {
                image: options.vibeTransfer.image.split(',')[1], // base64 데이터만 추출
                information_extracted: options.vibeTransfer.infoExtracted,
                strength: options.vibeTransfer.strength,
            },
        ];
    }

    // 캐릭터 레퍼런스 추가
    if (options.characterReference) {
        params.parameters.reference_image_multiple = params.parameters.reference_image_multiple || [];
        for (const imgData of options.characterReference.images) {
            params.parameters.reference_image_multiple.push({
                image: imgData.split(',')[1], // base64 데이터만 추출
                information_extracted: options.characterReference.infoExtracted,
                strength: options.characterReference.strength,
            });
        }
    }

    // 네거티브 프롬프트
    if (options.negativePrompt) {
        params.parameters.negative_prompt = options.negativePrompt;
    }

    console.log(`[${extensionName}] NAI API params:`, params);

    // 실제 API 호출은 SillyTavern의 백엔드를 통해 수행해야 함
    // 이 함수는 향후 직접 NAI API 호출이 필요할 때 사용
    return null;
}

// 재생성 모달 콜백 - 실제 재생성 로직
async function handleRegeneration(mesId, params) {
    const context = getContext();
    const message = context.chat[mesId];
    
    if (!message) {
        toastr.error('Message not found');
        return;
    }
    
    const { prompt, negativePrompt, width, height, steps, scale, seed, sampler, cfgRescale, variety } = params;
    
    if (!prompt) {
        toastr.warning('Prompt is required');
        return;
    }
    
    // 프리셋 적용
    const finalPrompt = applyPresetToPrompt(prompt);
    const extraParams = getNAIExtraParams(prompt);
    extraParams.negativePrompt = negativePrompt;
    
    // 커스텀 파라미터로 이미지 생성
    const result = await regenerateImageWithParams(finalPrompt, {
        negativePrompt,
        width,
        height,
        steps,
        scale,
        seed,
        sampler,
        cfgRescale,
        variety,
        ...extraParams
    });
    
    if (result) {
        // 메시지에 이미지 추가
        if (!message.extra) message.extra = {};
        
        // 새 media API 사용
        if (!Array.isArray(message.extra.media)) {
            message.extra.media = [];
        }
        
        // 새 이미지를 media 배열에 추가 (SillyTavern 형식: url, type)
        message.extra.media.push({ url: result, type: 'image', title: prompt });
        message.extra.title = prompt;
        message.extra.inline_image = true;
        
        // 메타데이터 업데이트
        message.extra.iagf_gen_params = {
            prompt,
            finalPrompt,
            negativePrompt,
            width,
            height,
            steps,
            scale,
            seed,
            sampler,
            cfgRescale,
            variety,
            model: extension_settings.sd?.model || 'nai-diffusion-4-5-full',
        };
        
        // UI 업데이트 - updateMessageBlock 사용하여 완전 갱신
        updateMessageBlock(mesId, message, { rerenderMessage: false });
        
        await context.saveChat();
        
        // 새 이미지로 swipe 이동
        const $mes = $(`.mes[mesid="${mesId}"]`);
        const swipeIndex = (message.extra.media?.length || 1) - 1;
        setTimeout(() => navigateToImageSwipe($mes, swipeIndex), 300);
        
        toastr.success('Image regenerated!');
    }
}

// 시드만 변경하여 재생성
async function regenerateWithNewSeed(mesId) {
    const context = getContext();
    const message = context.chat[mesId];
    
    if (!message || !message.extra?.iagf_gen_params) {
        toastr.warning('No generation parameters found for this image');
        return;
    }
    
    const genParams = message.extra.iagf_gen_params;
    const newSeed = Math.floor(Math.random() * 2147483647);
    
    toastr.info('Regenerating with new seed...', 'IAGF');
    
    try {
        const extraParams = getNAIExtraParams(genParams.prompt);
        extraParams.negativePrompt = genParams.negativePrompt;
        
        const result = await regenerateImageWithParams(genParams.finalPrompt || applyPresetToPrompt(genParams.prompt), {
            negativePrompt: genParams.negativePrompt,
            width: genParams.width,
            height: genParams.height,
            steps: genParams.steps,
            scale: genParams.scale,
            seed: newSeed,
            sampler: genParams.sampler,
            ...extraParams
        });
        
        if (result) {
            if (!message.extra) message.extra = {};
            
            // 새 media API 사용
            if (!Array.isArray(message.extra.media)) {
                message.extra.media = [];
            }
            
            // 새 이미지를 media 배열에 추가 (SillyTavern 형식: url, type)
            const currentTitle = message.extra.title || genParams.prompt || '';
            message.extra.media.push({ url: result, type: 'image', title: currentTitle });
            message.extra.inline_image = true;
            if (message.extra.iagf_gen_params) {
                message.extra.iagf_gen_params.seed = newSeed;
            }
            
            // UI 업데이트 - updateMessageBlock 사용하여 완전 갱신
            updateMessageBlock(mesId, message, { rerenderMessage: false });
            
            await context.saveChat();
            
            // 새 이미지로 swipe 이동
            const $mes = $(`.mes[mesid="${mesId}"]`);
            const swipeIndex = (message.extra.media?.length || 1) - 1;
            setTimeout(() => navigateToImageSwipe($mes, swipeIndex), 300);
            
            toastr.success('Image regenerated with new seed!');
        }
    } catch (error) {
        console.error(`[${extensionName}] Seed regeneration error:`, error);
        toastr.error(`Regeneration failed: ${error.message}`);
    }
}

// 커스텀 파라미터로 이미지 생성
async function regenerateImageWithParams(prompt, params) {
    const sdSettings = extension_settings.sd || {};
    const isNAI = sdSettings.source === 'novel';
    
    if (isNAI) {
        // NAI 직접 호출
        return await callNAIRegeneration(prompt, params);
    } else {
        // 기본 SD 명령 사용
        const result = await SlashCommandParser.commands['sd'].callback(
            { quiet: 'true' },
            prompt,
        );
        return result;
    }
}

async function callNAIRegeneration(prompt, params) {
    const sdSettings = extension_settings.sd || {};
    
    const model = params.model || sdSettings.model || 'nai-diffusion-4-5-full';
    const sampler = params.sampler || sdSettings.sampler || 'k_euler_ancestral';
    const scheduler = params.scheduler || sdSettings.scheduler || 'native';
    const steps = Math.min(params.steps || sdSettings.steps || 28, 50);
    const scale = parseFloat(params.scale || sdSettings.scale) || 5.0;
    const width = parseInt(params.width || sdSettings.width) || 832;
    const height = parseInt(params.height || sdSettings.height) || 1216;
    const seed = params.seed >= 0 ? params.seed : Math.floor(Math.random() * 2147483647);
    const negativePrompt = params.negativePrompt || '';
    const cfgRescale = parseFloat(params.cfgRescale) || 0;
    const variety = params.variety === true;
    
    const requestBody = {
        input: prompt,
        model: model,
        action: 'generate',
        parameters: {
            params_version: 3,
            width: width,
            height: height,
            noise_schedule: scheduler,
            controlnet_strength: 1,
            dynamic_thresholding: false,
            scale: scale,
            cfg_rescale: cfgRescale,
            sampler: sampler,
            steps: steps,
            seed: seed,
            n_samples: 1,
            ucPreset: 0,
            negative_prompt: negativePrompt,
            qualityToggle: true,
            use_coords: false,
            legacy: false,
            legacy_v3_extend: false,
            prefer_brownian: variety,
            autoSmea: false,
            v4_prompt: {
                caption: {
                    base_caption: prompt,
                    char_captions: [],
                },
                use_coords: false,
                use_order: true,
            },
            v4_negative_prompt: {
                caption: {
                    base_caption: negativePrompt,
                    char_captions: [],
                },
                legacy_uc: false,
            },
        },
    };
    
    // Vibe Transfer 추가
    if (params.vibeTransfer) {
        const vibeData = params.vibeTransfer;
        const imageData = stripBase64Header(vibeData.image);
        requestBody.parameters.reference_image_multiple = [imageData];
        requestBody.parameters.reference_strength_multiple = [parseFloat(vibeData.strength) || 0.6];
        requestBody.parameters.reference_information_extracted_multiple = [parseFloat(vibeData.infoExtracted) || 1.0];
    }
    
    // Character Reference 추가
    if (params.characterReference) {
        const charData = params.characterReference;
        const processedCharRefImages = [];
        for (const img of charData.images) {
            const resized = await resizeImageForReference(img, 'image/jpeg');
            processedCharRefImages.push(stripBase64Header(resized));
        }
        requestBody.parameters.director_reference_images = processedCharRefImages;
        requestBody.parameters.director_reference_strength_values = processedCharRefImages.map(() => 1.0);
        requestBody.parameters.director_reference_information_extracted = processedCharRefImages.map(() => 1.0);
        requestBody.parameters.director_reference_secondary_strength_values = processedCharRefImages.map(() => 1.0 - (parseFloat(charData.fidelity) || 0.6));
        const charRefCaption = charData.styleAware ? 'character&style' : 'character';
        requestBody.parameters.director_reference_descriptions = processedCharRefImages.map(() => ({
            caption: { base_caption: charRefCaption, char_captions: [] },
            legacy_uc: false,
        }));
    }
    
    let response;
    let usedPlugin = false;
    
    try {
        response = await fetch('/api/plugins/nai-reference-image/generate', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(requestBody),
        });
        usedPlugin = true;
    } catch (pluginError) {
        // 플러그인 사용 불가
    }
    
    if (!usedPlugin || response.status === 404) {
        // 폴백: 기본 NAI API
        const fallbackBody = {
            prompt: prompt,
            model: model,
            sampler: sampler,
            scheduler: scheduler,
            steps: steps,
            scale: scale,
            width: width,
            height: height,
            negative_prompt: negativePrompt,
            seed: seed,
        };
        
        response = await fetch('/api/novelai/generate-image', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(fallbackBody),
        });
    }
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`NAI API error: ${response.status} - ${errorText}`);
    }
    
    const imageData = await response.text();
    
    console.log(`[${extensionName}] NAI response length: ${imageData?.length}, starts with: ${imageData?.substring(0, 50)}`);
    
    if (!imageData) {
        throw new Error('NAI API returned empty response');
    }
    
    // base64 이미지를 파일로 업로드하고 경로 반환
    const base64Data = imageData.startsWith('data:') ? imageData : `data:image/png;base64,${imageData}`;
    console.log(`[${extensionName}] base64Data starts with: ${base64Data?.substring(0, 80)}`);
    const uploadedPath = await uploadBase64Image(base64Data);
    return uploadedPath;
}

// base64 이미지를 서버에 업로드하고 파일 경로 반환
async function uploadBase64Image(base64Data) {
    try {
        const filename = `iagf_regen_${Date.now()}`;
        
        // data:image/png;base64, 접두사 제거 (서버는 순수 base64만 받음)
        const pureBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
        
        // SillyTavern의 공식 saveBase64AsFile 함수 사용
        const savedPath = await stSaveBase64AsFile(pureBase64, 'iagf_generated', filename, 'png');
        console.log(`[${extensionName}] Image saved to: ${savedPath}`);
        return savedPath;
    } catch (error) {
        console.error(`[${extensionName}] Image upload error:`, error);
        // 업로드 실패 시 base64 데이터 그대로 반환 (폴백)
        console.warn(`[${extensionName}] Using base64 fallback`);
        return base64Data;
    }
}

// 이미지 컨테이너에 재생성 버튼 추가
function addRegenButtonsToImage(mesElement) {
    const $mes = $(mesElement);
    const mesId = $mes.attr('mesid');
    
    // 다양한 이미지 컨테이너 선택자 시도
    let $imgContainer = $mes.find('.mes_img_container');
    if (!$imgContainer.length) {
        $imgContainer = $mes.find('.mes_block .mes_img_wrapper');
    }
    if (!$imgContainer.length) {
        $imgContainer = $mes.find('.mes_block img').parent();
    }
    
    // 이미지가 있는 컨테이너 찾기
    const $img = $mes.find('.mes_img, .mes_block img[src*="data:image"], .mes_block img[src*="user_upload"]');
    if ($img.length && !$imgContainer.length) {
        $imgContainer = $img.closest('.mes_img_container, .mes_img_wrapper').length 
            ? $img.closest('.mes_img_container, .mes_img_wrapper') 
            : $img.parent();
    }
    
    if (!$imgContainer.length || $imgContainer.find('.iagf-regen-container').length) {
        return;
    }
    
    const context = getContext();
    const message = context.chat[mesId];
    
    // 이미지가 있는 경우에만 버튼 추가 (media 배열 또는 DOM에서 이미지 체크)
    const hasMedia = message?.extra?.media && message.extra.media.length > 0;
    const hasImage = $img.length > 0;
    if (!hasMedia && !hasImage) {
        return;
    }
    
    // 컨테이너에 position relative 설정
    if ($imgContainer.css('position') === 'static') {
        $imgContainer.css('position', 'relative');
    }
    
    const $regenContainer = $(`
        <div class="iagf-regen-container">
            <button class="iagf-regen-btn" data-action="reseed" data-mesid="${mesId}" title="Regenerate with new seed">
                <i class="fa-solid fa-dice"></i> Reseed
            </button>
            <button class="iagf-regen-btn" data-action="edit" data-mesid="${mesId}" title="Edit parameters and regenerate">
                <i class="fa-solid fa-pen"></i> Edit
            </button>
        </div>
    `);
    
    $imgContainer.append($regenContainer);
    console.log(`[${extensionName}] Regen buttons added to message ${mesId}`);
}

// 버튼 이벤트를 document 레벨에서 위임으로 처리
$(document).off('click.iagf_regen').on('click.iagf_regen', '.iagf-regen-btn', async function(e) {
    e.stopPropagation();
    e.preventDefault();
    
    const $btn = $(this);
    const action = $btn.data('action');
    const mesId = $btn.data('mesid');
    
    if ($btn.prop('disabled')) return;
    
    const context = getContext();
    const message = context.chat[mesId];
    
    if (action === 'reseed') {
        $btn.prop('disabled', true).addClass('generating');
        try {
            await regenerateWithNewSeed(mesId);
        } finally {
            $btn.prop('disabled', false).removeClass('generating');
        }
    } else if (action === 'edit') {
        const genParams = message?.extra?.iagf_gen_params || {
            prompt: message?.extra?.title || '',
            negativePrompt: '',
            width: 832,
            height: 1216,
            steps: 28,
            scale: 5.0,
            sampler: 'k_euler_ancestral',
        };
        // 모듈 버전 사용 - 콜백으로 handleRegeneration 전달
        openRegenModalModule(mesId, genParams, handleRegeneration);
    }
});

// 모든 메시지의 이미지에 재생성 버튼 추가
function addRegenButtonsToAllImages() {
    console.log(`[${extensionName}] Adding regen buttons to all images...`);
    $('#chat > .mes[mesid]').each(function() {
        addRegenButtonsToImage(this);
    });
}

// 기존 이벤트에 재생성 버튼 추가 연결
if (eventSource && event_types) {
    if (event_types.CHAT_CHANGED) {
        eventSource.on(event_types.CHAT_CHANGED, () => {
            setTimeout(addRegenButtonsToAllImages, 500);
        });
    }
    
    if (event_types.MESSAGE_RECEIVED) {
        eventSource.on(event_types.MESSAGE_RECEIVED, (mesId) => {
            setTimeout(() => {
                const $mes = $(`.mes[mesid="${mesId}"]`);
                if ($mes.length) addRegenButtonsToImage($mes[0]);
            }, 500);
        });
    }
    
    if (event_types.CHARACTER_MESSAGE_RENDERED) {
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (mesId) => {
            setTimeout(() => {
                const $mes = $(`.mes[mesid="${mesId}"]`);
                if ($mes.length) addRegenButtonsToImage($mes[0]);
            }, 500);
        });
    }
    
    // MESSAGE_UPDATED 이벤트도 추가 (이미지가 나중에 추가될 때)
    if (event_types.MESSAGE_UPDATED) {
        eventSource.on(event_types.MESSAGE_UPDATED, (mesId) => {
            setTimeout(() => {
                const $mes = $(`.mes[mesid="${mesId}"]`);
                if ($mes.length) addRegenButtonsToImage($mes[0]);
            }, 500);
        });
    }
}

// MutationObserver로 이미지 추가 감지
const imageObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const $node = $(node);
                // 이미지가 추가되었는지 확인
                if ($node.hasClass('mes_img_container') || $node.find('.mes_img_container').length || 
                    $node.is('img') || $node.find('img').length) {
                    const $mes = $node.closest('.mes[mesid]');
                    if ($mes.length) {
                        setTimeout(() => addRegenButtonsToImage($mes[0]), 100);
                    }
                }
            }
        });
    });
});

// Observer 시작
setTimeout(() => {
    const chatElement = document.getElementById('chat');
    if (chatElement) {
        imageObserver.observe(chatElement, { childList: true, subtree: true });
        console.log(`[${extensionName}] Image observer started`);
    }
}, 1000);

// 초기 로드 시 버튼 추가
setTimeout(addRegenButtonsToAllImages, 1500);

// 이미지 swipe 이동 함수
function navigateToImageSwipe($mes, targetIndex) {
    try {
        // 메시지 요소에서 이미지 컨테이너 찾기
        const $imgContainer = $mes.find('.mes_img_container');
        if (!$imgContainer.length) return;
        
        // SillyTavern의 이미지 swipe 버튼 찾기
        const $rightSwipe = $imgContainer.find('.mes_img_swipe_right, [data-action="swipe-right"]');
        const $leftSwipe = $imgContainer.find('.mes_img_swipe_left, [data-action="swipe-left"]');
        
        // 현재 swipe 인덱스 확인 (data 속성 또는 카운터에서)
        const $counter = $imgContainer.find('.mes_img_swipe_counter');
        let currentIndex = 0;
        
        if ($counter.length) {
            const counterText = $counter.text();
            const match = counterText.match(/(\d+)\s*\/\s*(\d+)/);
            if (match) {
                currentIndex = parseInt(match[1]) - 1; // 0-based index
            }
        }
        
        // 목표 인덱스까지 오른쪽으로 이동
        const clicksNeeded = targetIndex - currentIndex;
        
        if (clicksNeeded > 0 && $rightSwipe.length) {
            // 오른쪽으로 이동해야 함
            for (let i = 0; i < clicksNeeded; i++) {
                setTimeout(() => $rightSwipe.trigger('click'), i * 100);
            }
        } else if (clicksNeeded < 0 && $leftSwipe.length) {
            // 왼쪽으로 이동해야 함
            for (let i = 0; i < Math.abs(clicksNeeded); i++) {
                setTimeout(() => $leftSwipe.trigger('click'), i * 100);
            }
        }
        
        console.log(`[${extensionName}] Navigated to image swipe ${targetIndex + 1}`);
    } catch (error) {
        console.error(`[${extensionName}] Failed to navigate swipe:`, error);
    }
}

// 태그 자동완성을 위한 태그 데이터 로드
let autocompleteTagsLoaded = false;
let autocompleteTags = [];

async function loadAutocompleteTags() {
    if (autocompleteTagsLoaded) return;
    
    try {
        const response = await fetch(`${extensionFolderPath}/tags.json`);
        if (response.ok) {
            const text = await response.text();
            if (text.trim()) {
                autocompleteTags = JSON.parse(text);
                autocompleteTagsLoaded = true;
                console.log(`[${extensionName}] Loaded ${autocompleteTags.length} tags for autocomplete`);
            }
        }
    } catch (error) {
        console.log(`[${extensionName}] Could not load tags for autocomplete:`, error);
    }
}

// 태그 자동완성 초기화
function initTagAutocomplete() {
    loadAutocompleteTags();
    
    // 프롬프트 입력 필드에 autocomplete 컨테이너 추가
    $(document).on('focus', '#iagf_regen_prompt, #iagf_regen_negative', function() {
        const $field = $(this);
        const $parent = $field.parent();
        
        if (!$parent.hasClass('iagf-autocomplete-container')) {
            $field.wrap('<div class="iagf-autocomplete-container"></div>');
            $field.after('<div class="iagf-autocomplete-list"></div>');
        }
    });
    
    // 입력 이벤트 처리
    $(document).on('input', '#iagf_regen_prompt, #iagf_regen_negative', function() {
        const $input = $(this);
        const $list = $input.siblings('.iagf-autocomplete-list');
        
        if (!autocompleteTags.length) {
            $list.removeClass('visible');
            return;
        }
        
        // 현재 커서 위치에서 입력 중인 단어 찾기
        const text = $input.val();
        const cursorPos = this.selectionStart;
        
        // 마지막 쉼표 이후의 텍스트 찾기
        const lastComma = text.lastIndexOf(',', cursorPos - 1);
        const currentWord = text.substring(lastComma + 1, cursorPos).trim().toLowerCase();
        
        if (currentWord.length < 2) {
            $list.removeClass('visible');
            return;
        }
        
        // 매칭되는 태그 찾기 (앞에서부터 시작하는 태그만)
        const matches = autocompleteTags
            .filter(tag => {
                const label = (tag.label || tag).toLowerCase();
                return label.startsWith(currentWord);
            })
            .slice(0, 10);
        
        if (matches.length === 0) {
            $list.removeClass('visible');
            return;
        }
        
        // 자동완성 목록 표시
        $list.empty();
        matches.forEach((tag, index) => {
            const label = tag.label || tag;
            const count = tag.count || '';
            $list.append(`
                <div class="iagf-autocomplete-item" data-tag="${escapeHtmlAttribute(label)}" data-index="${index}">
                    <span>${escapeHtmlAttribute(label)}</span>
                    ${count ? `<span class="tag-count">${count}</span>` : ''}
                </div>
            `);
        });
        $list.addClass('visible');
    });
    
    // 자동완성 아이템 클릭
    $(document).on('click', '.iagf-autocomplete-item', function() {
        const tag = $(this).data('tag');
        const $list = $(this).parent();
        const $input = $list.siblings('textarea');
        
        insertTagAtCursor($input[0], tag);
        $list.removeClass('visible');
    });
    
    // 키보드 네비게이션
    $(document).on('keydown', '#iagf_regen_prompt, #iagf_regen_negative', function(e) {
        const $input = $(this);
        const $list = $input.siblings('.iagf-autocomplete-list');
        
        if (!$list.hasClass('visible')) return;
        
        const $items = $list.find('.iagf-autocomplete-item');
        const $selected = $list.find('.iagf-autocomplete-item.selected');
        let selectedIndex = $selected.length ? $selected.data('index') : -1;
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, $items.length - 1);
            $items.removeClass('selected');
            $items.eq(selectedIndex).addClass('selected');
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, 0);
            $items.removeClass('selected');
            $items.eq(selectedIndex).addClass('selected');
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if ($selected.length) {
                e.preventDefault();
                const tag = $selected.data('tag');
                insertTagAtCursor(this, tag);
                $list.removeClass('visible');
            }
        } else if (e.key === 'Escape') {
            $list.removeClass('visible');
        }
    });
    
    // 입력 필드 외부 클릭 시 목록 닫기
    $(document).on('click', function(e) {
        if (!$(e.target).closest('.iagf-autocomplete-container').length) {
            $('.iagf-autocomplete-list').removeClass('visible');
        }
    });
}

// 커서 위치에 태그 삽입
function insertTagAtCursor(input, tag) {
    const text = input.value;
    const cursorPos = input.selectionStart;
    
    // 마지막 쉼표 이후의 텍스트 찾기
    const lastComma = text.lastIndexOf(',', cursorPos - 1);
    const beforeWord = text.substring(0, lastComma + 1);
    const afterCursor = text.substring(cursorPos);
    
    // 새 텍스트 구성
    const needsSpace = beforeWord.length > 0 && !beforeWord.endsWith(' ');
    const newText = beforeWord + (needsSpace ? ' ' : '') + tag + ', ' + afterCursor.trimStart();
    
    input.value = newText;
    
    // 커서 위치 조정
    const newCursorPos = beforeWord.length + (needsSpace ? 1 : 0) + tag.length + 2;
    input.setSelectionRange(newCursorPos, newCursorPos);
    input.focus();
}

// 태그 자동완성 초기화 실행
initTagAutocomplete();

// ============ 대시보드 모달 초기화 (모듈 사용) ============

function initializeDashboard() {
    // CSS 로드
    if (!$('#iagf-dashboard-styles').length) {
        const cssLink = document.createElement('link');
        cssLink.id = 'iagf-dashboard-styles';
        cssLink.rel = 'stylesheet';
        cssLink.href = `${extensionFolderPath}/styles/dashboard.css`;
        document.head.appendChild(cssLink);
    }

    // DashboardModal 모듈 인스턴스 생성
    if (!iagfManagers.dashboard) {
        const settings = extension_settings[extensionName];
        iagfManagers.dashboard = new DashboardModal({
            settings: settings,
            managers: iagfManagers,
            saveSettings: saveSettingsDebounced,
            onUpdate: updateUI,
            getConnectionProfiles: getConnectionProfiles,
            generatePreview: async (prompt, negativePrompt) => {
                try {
                    return await iagfManagers.naiApi.generatePreview(prompt, negativePrompt);
                } catch (error) {
                    console.error(`[${extensionName}] Preview generation failed:`, error);
                    return null;
                }
            },
        });
        iagfManagers.dashboard.initialize();
    }
}

function openDashboard() {
    if (iagfManagers.dashboard) {
        iagfManagers.dashboard.open();
    }
}

function closeDashboard() {
    if (iagfManagers.dashboard) {
        iagfManagers.dashboard.close();
    }
}

function toggleDashboard() {
    if (iagfManagers.dashboard) {
        iagfManagers.dashboard.toggle();
    }
}

// 대시보드 초기화 실행 (DOM 준비 후)
setTimeout(initializeDashboard, 1000);

// 내보내기 (다른 확장에서 사용할 수 있도록)
window.imageAutoGeneration = {
    applyPresetToPrompt,
    getNAIExtraParams,
    regenerateWithNewSeed,
    openRegenModal: openRegenModalModule,
    navigateToImageSwipe,
    openDashboard,
    closeDashboard,
    toggleDashboard,
};