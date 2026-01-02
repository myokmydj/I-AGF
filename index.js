import { extension_settings, getContext } from '../../../extensions.js';
import {
    saveSettingsDebounced,
    eventSource,
    event_types,
    updateMessageBlock,
    getRequestHeaders,
} from '../../../../script.js';
import { appendMediaToMessage } from '../../../../script.js';
import { regexFromString } from '../../../utils.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';

const extensionName = 'st-image-auto-generation';
const extensionFolderPath = `/scripts/extensions/third-party/${extensionName}`;

let TagMatcher = null;
let tagMatcherReady = false;

let currentNAIStatus = {
    vibeTransfer: null,
    characterReference: null,
    preset: null,
};

let currentBotName = null;

const INSERT_TYPE = {
    DISABLED: 'disabled',
    INLINE: 'inline',
    NEW_MESSAGE: 'new',
    REPLACE: 'replace',
};

function escapeHtmlAttribute(value) {
    if (typeof value !== 'string') {
        return '';
    }

    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

const defaultSettings = {
    insertType: INSERT_TYPE.DISABLED,
    promptInjection: {
        enabled: true,
        prompt: `<image_generation>
You must insert a <pic prompt="example prompt"> at end of the reply. Prompts are used for stable diffusion image generation, based on the plot and character to output appropriate prompts to generate captivating images.
</image_generation>`,
        regex: '/<pic[^>]*\\sprompt="([^"]*)"[^>]*?>/g',
        position: 'deep_system', // deep_system, deep_user, deep_assistant
        depth: 0,
    },
    presets: {
        default: {
            name: 'Default',
            prefixPrompt: '',
            suffixPrompt: '',
            negativePrompt: '',
        },
    },
    currentPreset: 'default',
    vibeTransfer: {
        enabled: false,
        images: {},
        selectedImageId: null,
        defaultStrength: 0.6,
        defaultInfoExtracted: 1.0,
    },
    characterReference: {
        enabled: false,
        characters: {},
        selectedCharacter: null,
        defaultFidelity: 0.6,
        defaultStyleAware: false,
    },
    tagMatching: {
        enabled: false,
        useFuzzyBest: true,
        keepUnmatched: true,
        showStats: true,
    },
    characterPrompts: {
        enabled: false,
        positionEnabled: false,
        perBot: {},
    },
};

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

async function resizeImageForReference(base64Data) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const { canvasWidth, canvasHeight } = chooseReferenceResolution(img.width, img.height);
            
            const canvas = document.createElement('canvas');
            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
            
            const ctx = canvas.getContext('2d');
            
            const scale = Math.min(canvasWidth / img.width, canvasHeight / img.height);
            const w = Math.floor(scale * img.width);
            const h = Math.floor(scale * img.height);
            const x = Math.floor((canvasWidth - w) / 2);
            const y = Math.floor((canvasHeight - h) / 2);
            
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            ctx.drawImage(img, x, y, w, h);
            
            const resizedBase64 = canvas.toDataURL('image/png');
            resolve(resizedBase64);
        };
        img.onerror = reject;
        img.src = base64Data;
    });
}

function stripBase64Header(base64Data) {
    if (base64Data.includes(',')) {
        return base64Data.split(',')[1];
    }
    return base64Data;
}

function updateUI() {
    $('#auto_generation').toggleClass(
        'selected',
        extension_settings[extensionName].insertType !== INSERT_TYPE.DISABLED,
    );

    // 只在表单元素存在时更新它们
    if ($('#image_generation_insert_type').length) {
        $('#image_generation_insert_type').val(
            extension_settings[extensionName].insertType,
        );
        $('#prompt_injection_enabled').prop(
            'checked',
            extension_settings[extensionName].promptInjection.enabled,
        );
        $('#prompt_injection_text').val(
            extension_settings[extensionName].promptInjection.prompt,
        );
        $('#prompt_injection_regex').val(
            extension_settings[extensionName].promptInjection.regex,
        );
        $('#prompt_injection_position').val(
            extension_settings[extensionName].promptInjection.position,
        );
        $('#prompt_injection_depth').val(
            extension_settings[extensionName].promptInjection.depth,
        );

        updatePresetUI();
        updateVibeTransferUI();
        updateCharacterReferenceUI();
        updateTagMatchingUI();
        updateCharacterPromptsUI();
        updateStatusPanel();
    }
}

function updatePresetUI(forceUpdateFields = true) {
    const settings = extension_settings[extensionName];
    const presetSelect = $('#image_preset_select');
    const currentValue = presetSelect.val();
    
    presetSelect.empty();

    for (const [key, preset] of Object.entries(settings.presets)) {
        presetSelect.append(
            `<option value="${key}">${escapeHtmlAttribute(preset.name)}</option>`,
        );
    }

    presetSelect.val(settings.currentPreset);

    if (forceUpdateFields) {
        const currentPreset = settings.presets[settings.currentPreset];
        if (currentPreset) {
            $('#preset_name_input').val(currentPreset.name);
            $('#preset_prefix_prompt').val(currentPreset.prefixPrompt || '');
            $('#preset_suffix_prompt').val(currentPreset.suffixPrompt || '');
            $('#preset_negative_prompt').val(currentPreset.negativePrompt || '');
        }
    }
}

function updateVibeTransferUI() {
    const settings = extension_settings[extensionName];
    const vibeSettings = settings.vibeTransfer;

    $('#vibe_transfer_enabled').prop('checked', vibeSettings.enabled);
    $('#vibe_strength').val(vibeSettings.defaultStrength);
    $('#vibe_info_extracted').val(vibeSettings.defaultInfoExtracted);

    const vibeSelect = $('#vibe_image_select');
    vibeSelect.empty();
    vibeSelect.append('<option value="">-- Select Vibe --</option>');

    for (const [id, image] of Object.entries(vibeSettings.images)) {
        vibeSelect.append(
            `<option value="${id}">${escapeHtmlAttribute(image.name)}</option>`,
        );
    }

    if (vibeSettings.selectedImageId) {
        vibeSelect.val(vibeSettings.selectedImageId);
    }

    updateVibeImagesGrid();
}

function updateVibeImagesGrid() {
    const settings = extension_settings[extensionName];
    const vibeSettings = settings.vibeTransfer;
    const container = $('#vibe_images_container');
    container.empty();

    for (const [id, image] of Object.entries(vibeSettings.images)) {
        const isSelected = vibeSettings.selectedImageId === id;
        const isActive = image.active !== false;
        const itemHtml = `
            <div class="image_grid_item ${isSelected ? 'selected' : ''} ${!isActive ? 'disabled' : ''}" data-id="${id}">
                <img src="${image.data}" alt="${escapeHtmlAttribute(image.name)}" title="${escapeHtmlAttribute(image.name)}">
                <button class="toggle_btn ${isActive ? 'active' : ''}" data-id="${id}" title="${isActive ? 'Click to disable' : 'Click to enable'}">
                    <i class="fa-solid ${isActive ? 'fa-check' : 'fa-ban'}"></i>
                </button>
                <button class="delete_btn" data-id="${id}"><i class="fa-solid fa-times"></i></button>
            </div>
        `;
        container.append(itemHtml);
    }

    container.find('.image_grid_item').on('click', function (e) {
        if ($(e.target).closest('.delete_btn').length) return;
        if ($(e.target).closest('.toggle_btn').length) return;

        const id = $(this).data('id');
        vibeSettings.selectedImageId = id;
        $('#vibe_image_select').val(id);
        updateVibeImagesGrid();
        updateStatusPanel();
        saveSettingsDebounced();
    });

    // 토글 버튼 이벤트 (활성화/비활성화)
    container.find('.toggle_btn').on('click', function (e) {
        e.stopPropagation();
        const id = $(this).data('id');
        const image = vibeSettings.images[id];
        if (image) {
            image.active = image.active === false;
            updateVibeImagesGrid();
            updateStatusPanel();
            saveSettingsDebounced();
        }
    });

    // 삭제 버튼 이벤트
    container.find('.delete_btn').on('click', function (e) {
        e.stopPropagation();
        const id = $(this).data('id');
        delete vibeSettings.images[id];
        if (vibeSettings.selectedImageId === id) {
            vibeSettings.selectedImageId = null;
        }
        updateVibeTransferUI();
        updateStatusPanel();
        saveSettingsDebounced();
    });
}

function updateCharacterReferenceUI() {
    const settings = extension_settings[extensionName];
    const charSettings = settings.characterReference;

    $('#char_reference_enabled').prop('checked', charSettings.enabled);
    $('#char_ref_fidelity').val(charSettings.defaultFidelity);
    $('#char_ref_style_aware').prop('checked', charSettings.defaultStyleAware);

    const charSelect = $('#char_reference_select');
    charSelect.empty();
    charSelect.append('<option value="">-- Select Character --</option>');

    for (const charName of Object.keys(charSettings.characters)) {
        charSelect.append(
            `<option value="${escapeHtmlAttribute(charName)}">${escapeHtmlAttribute(charName)}</option>`,
        );
    }

    if (charSettings.selectedCharacter) {
        charSelect.val(charSettings.selectedCharacter);
    }

    updateCharacterImagesGrid();
}

function updateCharacterImagesGrid() {
    const settings = extension_settings[extensionName];
    const charSettings = settings.characterReference;
    const container = $('#char_reference_images_container');
    container.empty();

    const selectedChar = charSettings.selectedCharacter;
    if (!selectedChar || !charSettings.characters[selectedChar]) {
        container.append('<p class="hint">Select a character to view/add reference images</p>');
        return;
    }

    const charData = charSettings.characters[selectedChar];
    const selectedImageId = charData.selectedImageId || null;
    
    for (const [id, image] of Object.entries(charData.images || {})) {
        const isSelected = selectedImageId === id;
        const isActive = image.active !== false;
        const itemHtml = `
            <div class="image_grid_item ${isSelected ? 'selected' : ''} ${!isActive ? 'disabled' : ''}" data-id="${id}">
                <img src="${image.data}" alt="${escapeHtmlAttribute(image.name)}" title="${escapeHtmlAttribute(image.name)}">
                <button class="toggle_btn ${isActive ? 'active' : ''}" data-id="${id}" title="${isActive ? 'Click to disable' : 'Click to enable'}">
                    <i class="fa-solid ${isActive ? 'fa-check' : 'fa-ban'}"></i>
                </button>
                <button class="delete_btn" data-id="${id}"><i class="fa-solid fa-times"></i></button>
                ${isSelected ? '<span class="selected_badge">IN USE</span>' : ''}
            </div>
        `;
        container.append(itemHtml);
    }

    container.find('.image_grid_item').on('click', function (e) {
        if ($(e.target).closest('.delete_btn').length) return;
        if ($(e.target).closest('.toggle_btn').length) return;

        const id = $(this).data('id');
        const image = charData.images[id];
        
        if (image && image.active === false) {
            toastr.warning('Enable the image first to select it');
            return;
        }
        
        if (charData.selectedImageId === id) {
            charData.selectedImageId = null;
        } else {
            charData.selectedImageId = id;
        }
        
        updateCharacterImagesGrid();
        updateStatusPanel();
        saveSettingsDebounced();
    });

    // 토글 버튼 이벤트 (활성화/비활성화)
    container.find('.toggle_btn').on('click', function (e) {
        e.stopPropagation();
        const id = $(this).data('id');
        const image = charData.images[id];
        if (image) {
            image.active = image.active === false;
            
            if (image.active === false && charData.selectedImageId === id) {
                charData.selectedImageId = null;
            }
            
            updateCharacterImagesGrid();
            updateStatusPanel();
            saveSettingsDebounced();
        }
    });

    // 삭제 버튼 이벤트
    container.find('.delete_btn').on('click', function (e) {
        e.stopPropagation();
        const id = $(this).data('id');
        
        if (charData.selectedImageId === id) {
            charData.selectedImageId = null;
        }
        
        delete charData.images[id];
        updateCharacterImagesGrid();
        updateStatusPanel();
        saveSettingsDebounced();
    });
}

function updateTagMatchingUI() {
    const settings = extension_settings[extensionName];
    const tagSettings = settings.tagMatching || defaultSettings.tagMatching;

    $('#tag_matching_enabled').prop('checked', tagSettings.enabled);
    $('#tag_matching_fuzzy_best').prop('checked', tagSettings.useFuzzyBest);
    $('#tag_matching_keep_unmatched').prop('checked', tagSettings.keepUnmatched);
    $('#tag_matching_show_stats').prop('checked', tagSettings.showStats);

    const statusEl = $('#tag_matching_status_value');
    if (tagSettings.enabled) {
        if (tagMatcherReady) {
            statusEl.text('Ready ✓').removeClass('loading error').addClass('ready');
        } else if (TagMatcher) {
            statusEl.text('Loading...').removeClass('ready error').addClass('loading');
        } else {
            statusEl.text('Not initialized').removeClass('ready loading').addClass('error');
        }
    } else {
        statusEl.text('Disabled').removeClass('ready loading error');
    }
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

function updateCharacterPromptsUI() {
    const settings = extension_settings[extensionName];
    const charPromptSettings = settings.characterPrompts || defaultSettings.characterPrompts;
    const botName = getCurrentBotName();
    
    $('#char_prompts_enabled').prop('checked', charPromptSettings.enabled);
    $('#char_prompts_position_enabled').prop('checked', charPromptSettings.positionEnabled);
    
    const botNameDisplay = botName || 'No bot selected';
    $('#current_bot_name').text(botNameDisplay);
    
    updateCharacterPromptsList();
}

function updateCharacterPromptsList() {
    const container = $('#char_prompts_list');
    container.empty();
    
    const characters = getCurrentBotCharacterPrompts();
    const botName = getCurrentBotName();
    
    if (!botName) {
        container.append('<p class="hint">채팅을 열어 봇을 선택하세요</p>');
        return;
    }
    
    if (characters.length === 0) {
        container.append('<p class="hint">캐릭터 프롬프트가 없습니다. 추가 버튼을 눌러 추가하세요.</p>');
        return;
    }
    
    const settings = extension_settings[extensionName];
    const positionEnabled = settings.characterPrompts?.positionEnabled || false;
    
    characters.forEach((char, index) => {
        const isEnabled = char.enabled !== false;
        const color = getCharacterColor(index);
        
        const charHtml = `
            <div class="char_prompt_item ${isEnabled ? '' : 'disabled'}" data-id="${char.id}">
                <div class="char_prompt_header">
                    <div class="char_prompt_badge" style="background-color: ${positionEnabled ? color : 'var(--SmartThemeBorderColor)'};">${index + 1}</div>
                    <input type="text" class="char_prompt_name text_pole" value="${escapeHtmlAttribute(char.name || '')}" placeholder="캐릭터 이름 (선택)">
                    <button class="char_prompt_toggle menu_button_icon ${isEnabled ? 'active' : ''}" data-id="${char.id}" title="${isEnabled ? 'Disable' : 'Enable'}">
                        <i class="fa-solid ${isEnabled ? 'fa-eye' : 'fa-eye-slash'}"></i>
                    </button>
                    <button class="char_prompt_delete menu_button_icon" data-id="${char.id}" title="Delete">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
                <div class="char_prompt_body">
                    <div class="char_prompt_field">
                        <label>프롬프트</label>
                        <textarea class="char_prompt_text text_pole" placeholder="캐릭터 외형 태그 (예: 1girl, blue hair, red eyes...)">${escapeHtmlAttribute(char.prompt || '')}</textarea>
                    </div>
                    <div class="char_prompt_field">
                        <label class="negative_label">네거티브</label>
                        <textarea class="char_prompt_negative text_pole" placeholder="제외할 태그 (선택)">${escapeHtmlAttribute(char.negative || '')}</textarea>
                    </div>
                    ${positionEnabled ? `
                    <div class="char_prompt_position">
                        <label>위치 (X: ${(char.position?.x || 0.5).toFixed(2)}, Y: ${(char.position?.y || 0.5).toFixed(2)})</label>
                        <div class="position_controls">
                            <input type="range" class="char_position_x" min="0" max="1" step="0.05" value="${char.position?.x || 0.5}">
                            <input type="range" class="char_position_y" min="0" max="1" step="0.05" value="${char.position?.y || 0.5}">
                        </div>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
        container.append(charHtml);
    });
    
    bindCharacterPromptsEvents(container);
    
    container.find('input, textarea').each(function() {
        const el = this;
        
        ['keydown', 'keyup', 'keypress'].forEach(eventType => {
            el.addEventListener(eventType, function(e) {
                e.stopPropagation();
                e.stopImmediatePropagation();
            }, true);
        });
        
        $(el).on('keydown keyup keypress', function(e) {
            e.stopPropagation();
            e.stopImmediatePropagation();
        });
    }).on('mousedown click', function(e) {
        e.stopPropagation();
        $(this).focus();
    });
}

const CHARACTER_COLORS = [
    '#22c55e',
    '#ef4444',
    '#3b82f6',
    '#f59e0b',
    '#a855f7',
    '#06b6d4',
];

function getCharacterColor(index) {
    return CHARACTER_COLORS[index % CHARACTER_COLORS.length];
}

let charPromptSaveTimer = null;

function saveCharacterPromptsDebounced(characters) {
    if (charPromptSaveTimer) {
        clearTimeout(charPromptSaveTimer);
    }
    charPromptSaveTimer = setTimeout(() => {
        setCurrentBotCharacterPrompts(characters);
        charPromptSaveTimer = null;
    }, 500);
}

function bindCharacterPromptsEvents(container) {
    const characters = getCurrentBotCharacterPrompts();
    
    container.find('.char_prompt_name').on('input', function() {
        const item = $(this).closest('.char_prompt_item');
        const id = item.data('id');
        const char = characters.find(c => c.id === id);
        if (char) {
            char.name = $(this).val();
            saveCharacterPromptsDebounced(characters);
        }
    });
    
    container.find('.char_prompt_text').on('input', function() {
        const item = $(this).closest('.char_prompt_item');
        const id = item.data('id');
        const char = characters.find(c => c.id === id);
        if (char) {
            char.prompt = $(this).val();
            saveCharacterPromptsDebounced(characters);
        }
    });
    
    container.find('.char_prompt_negative').on('input', function() {
        const item = $(this).closest('.char_prompt_item');
        const id = item.data('id');
        const char = characters.find(c => c.id === id);
        if (char) {
            char.negative = $(this).val();
            saveCharacterPromptsDebounced(characters);
        }
    });
    
    container.find('.char_position_x').on('input', function() {
        const item = $(this).closest('.char_prompt_item');
        const id = item.data('id');
        const char = characters.find(c => c.id === id);
        if (char) {
            if (!char.position) char.position = { x: 0.5, y: 0.5 };
            char.position.x = parseFloat($(this).val());
            item.find('.char_prompt_position label').text(`위치 (X: ${char.position.x.toFixed(2)}, Y: ${char.position.y.toFixed(2)})`);
            saveCharacterPromptsDebounced(characters);
        }
    });
    
    container.find('.char_position_y').on('input', function() {
        const item = $(this).closest('.char_prompt_item');
        const id = item.data('id');
        const char = characters.find(c => c.id === id);
        if (char) {
            if (!char.position) char.position = { x: 0.5, y: 0.5 };
            char.position.y = parseFloat($(this).val());
            item.find('.char_prompt_position label').text(`위치 (X: ${char.position.x.toFixed(2)}, Y: ${char.position.y.toFixed(2)})`);
            saveCharacterPromptsDebounced(characters);
        }
    });
    
    container.find('.char_prompt_toggle').on('click', function() {
        const id = $(this).data('id');
        const char = characters.find(c => c.id === id);
        if (char) {
            char.enabled = char.enabled === false;
            setCurrentBotCharacterPrompts(characters);
            updateCharacterPromptsList();
            updateStatusPanel();
        }
    });
    
    container.find('.char_prompt_delete').on('click', function() {
        const id = $(this).data('id');
        const index = characters.findIndex(c => c.id === id);
        if (index !== -1) {
            characters.splice(index, 1);
            setCurrentBotCharacterPrompts(characters);
            updateCharacterPromptsList();
            updateStatusPanel();
        }
    });
}

async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};

    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    } else {
        if (!extension_settings[extensionName].promptInjection) {
            extension_settings[extensionName].promptInjection =
                defaultSettings.promptInjection;
        } else {
            const defaultPromptInjection = defaultSettings.promptInjection;
            for (const key in defaultPromptInjection) {
                if (
                    extension_settings[extensionName].promptInjection[key] ===
                    undefined
                ) {
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
            extension_settings[extensionName].presets = defaultSettings.presets;
        }
        if (!extension_settings[extensionName].currentPreset) {
            extension_settings[extensionName].currentPreset = defaultSettings.currentPreset;
        }

        if (!extension_settings[extensionName].vibeTransfer) {
            extension_settings[extensionName].vibeTransfer = defaultSettings.vibeTransfer;
        } else {
            for (const key in defaultSettings.vibeTransfer) {
                if (extension_settings[extensionName].vibeTransfer[key] === undefined) {
                    extension_settings[extensionName].vibeTransfer[key] = defaultSettings.vibeTransfer[key];
                }
            }
        }

        if (!extension_settings[extensionName].characterReference) {
            extension_settings[extensionName].characterReference = defaultSettings.characterReference;
        } else {
            for (const key in defaultSettings.characterReference) {
                if (extension_settings[extensionName].characterReference[key] === undefined) {
                    extension_settings[extensionName].characterReference[key] = defaultSettings.characterReference[key];
                }
            }
        }

        if (!extension_settings[extensionName].tagMatching) {
            extension_settings[extensionName].tagMatching = defaultSettings.tagMatching;
        } else {
            for (const key in defaultSettings.tagMatching) {
                if (extension_settings[extensionName].tagMatching[key] === undefined) {
                    extension_settings[extensionName].tagMatching[key] = defaultSettings.tagMatching[key];
                }
            }
        }

        if (!extension_settings[extensionName].characterPrompts) {
            extension_settings[extensionName].characterPrompts = defaultSettings.characterPrompts;
        } else {
            for (const key in defaultSettings.characterPrompts) {
                if (extension_settings[extensionName].characterPrompts[key] === undefined) {
                    extension_settings[extensionName].characterPrompts[key] = defaultSettings.characterPrompts[key];
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

    $('#image_generation_insert_type').on('change', function () {
        const newValue = $(this).val();
        extension_settings[extensionName].insertType = newValue;
        updateUI();
        saveSettingsDebounced();
    });

    $('#prompt_injection_enabled').on('change', function () {
        extension_settings[extensionName].promptInjection.enabled =
            $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#prompt_injection_text').on('input', function () {
        extension_settings[extensionName].promptInjection.prompt =
            $(this).val();
        saveSettingsDebounced();
    });

    $('#prompt_injection_regex').on('input', function () {
        extension_settings[extensionName].promptInjection.regex = $(this).val();
        saveSettingsDebounced();
    });

    $('#prompt_injection_position').on('change', function () {
        extension_settings[extensionName].promptInjection.position =
            $(this).val();
        saveSettingsDebounced();
    });

    $('#prompt_injection_depth').on('input', function () {
        const value = parseInt(String($(this).val()));
        extension_settings[extensionName].promptInjection.depth = isNaN(value)
            ? 0
            : value;
        saveSettingsDebounced();
    });

    $('#image_preset_select').on('change', function () {
        const presetKey = $(this).val();
        extension_settings[extensionName].currentPreset = presetKey;
        updatePresetUI();
        saveSettingsDebounced();
    });

    $('#image_preset_add').on('click', function () {
        const newKey = 'preset_' + Date.now();
        extension_settings[extensionName].presets[newKey] = {
            name: 'New Preset',
            prefixPrompt: '',
            suffixPrompt: '',
            negativePrompt: '',
        };
        extension_settings[extensionName].currentPreset = newKey;
        updatePresetUI();
        saveSettingsDebounced();
    });

    $('#image_preset_delete').on('click', function () {
        const currentKey = extension_settings[extensionName].currentPreset;
        if (currentKey === 'default') {
            toastr.warning('Cannot delete the default preset');
            return;
        }
        delete extension_settings[extensionName].presets[currentKey];
        extension_settings[extensionName].currentPreset = 'default';
        updatePresetUI();
        saveSettingsDebounced();
    });

    $('#preset_name_input').on('input', function () {
        const currentKey = extension_settings[extensionName].currentPreset;
        const preset = extension_settings[extensionName].presets[currentKey];
        if (preset) {
            preset.name = $(this).val() || 'Unnamed';
            updatePresetUI(false);
            saveSettingsDebounced();
        }
    });

    $('#preset_prefix_prompt').on('input', function () {
        const currentKey = extension_settings[extensionName].currentPreset;
        const preset = extension_settings[extensionName].presets[currentKey];
        if (preset) {
            preset.prefixPrompt = $(this).val() || '';
            saveSettingsDebounced();
        }
    });

    $('#preset_suffix_prompt').on('input', function () {
        const currentKey = extension_settings[extensionName].currentPreset;
        const preset = extension_settings[extensionName].presets[currentKey];
        if (preset) {
            preset.suffixPrompt = $(this).val() || '';
            saveSettingsDebounced();
        }
    });

    $('#preset_negative_prompt').on('input', function () {
        const currentKey = extension_settings[extensionName].currentPreset;
        const preset = extension_settings[extensionName].presets[currentKey];
        if (preset) {
            preset.negativePrompt = $(this).val() || '';
            saveSettingsDebounced();
        }
    });

    $('#preset_save').on('click', function () {
        const currentKey = extension_settings[extensionName].currentPreset;
        const preset = extension_settings[extensionName].presets[currentKey];
        if (preset) {
            preset.name = $('#preset_name_input').val() || 'Unnamed';
            preset.prefixPrompt = $('#preset_prefix_prompt').val() || '';
            preset.suffixPrompt = $('#preset_suffix_prompt').val() || '';
            preset.negativePrompt = $('#preset_negative_prompt').val() || '';
            updatePresetUI(false);
            saveSettingsDebounced();
            toastr.success('Preset saved');
        }
    });

    $('#vibe_transfer_enabled').on('change', function () {
        extension_settings[extensionName].vibeTransfer.enabled = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#vibe_image_select').on('change', function () {
        const id = $(this).val();
        extension_settings[extensionName].vibeTransfer.selectedImageId = id || null;
        updateVibeImagesGrid();
        saveSettingsDebounced();
    });

    $('#vibe_strength').on('input', function () {
        const value = parseFloat($(this).val());
        extension_settings[extensionName].vibeTransfer.defaultStrength = isNaN(value) ? 0.6 : value;
        saveSettingsDebounced();
    });

    $('#vibe_info_extracted').on('input', function () {
        const value = parseFloat($(this).val());
        extension_settings[extensionName].vibeTransfer.defaultInfoExtracted = isNaN(value) ? 1.0 : value;
        saveSettingsDebounced();
    });

    $('#vibe_image_add_btn').on('click', function () {
        $('#vibe_image_upload').trigger('click');
    });

    $('#vibe_image_upload').on('change', async function (e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const base64 = await fileToBase64(file);
            const resizedBase64 = await resizeImageForReference(base64, 1024);
            const id = generateImageId();
            extension_settings[extensionName].vibeTransfer.images[id] = {
                name: file.name,
                data: resizedBase64,
                active: true,
            };
            extension_settings[extensionName].vibeTransfer.selectedImageId = id;
            updateVibeTransferUI();
            updateStatusPanel();
            saveSettingsDebounced();
            toastr.success('Vibe image added (resized for NAI)');
        } catch (error) {
            toastr.error('Failed to add vibe image');
        }

        $(this).val('');
    });

    $('#char_reference_enabled').on('change', function () {
        extension_settings[extensionName].characterReference.enabled = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#char_reference_select').on('change', function () {
        const charName = $(this).val();
        extension_settings[extensionName].characterReference.selectedCharacter = charName || null;
        updateCharacterImagesGrid();
        updateStatusPanel();
        saveSettingsDebounced();
    });

    $('#char_ref_fidelity').on('input', function () {
        const value = parseFloat($(this).val());
        extension_settings[extensionName].characterReference.defaultFidelity = isNaN(value) ? 0.6 : value;
        saveSettingsDebounced();
    });

    $('#char_ref_style_aware').on('change', function () {
        extension_settings[extensionName].characterReference.defaultStyleAware = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#char_reference_add').on('click', function () {
        const charName = prompt('Enter character name:');
        if (!charName || charName.trim() === '') return;

        const trimmedName = charName.trim();
        if (extension_settings[extensionName].characterReference.characters[trimmedName]) {
            toastr.warning('Character already exists');
            return;
        }

        extension_settings[extensionName].characterReference.characters[trimmedName] = {
            images: {},
            selectedImageId: null,
            fidelity: extension_settings[extensionName].characterReference.defaultFidelity,
            styleAware: extension_settings[extensionName].characterReference.defaultStyleAware,
        };
        extension_settings[extensionName].characterReference.selectedCharacter = trimmedName;
        updateCharacterReferenceUI();
        updateStatusPanel();
        saveSettingsDebounced();
        toastr.success(`Character "${trimmedName}" added`);
    });

    $('#char_reference_delete').on('click', function () {
        const selectedChar = extension_settings[extensionName].characterReference.selectedCharacter;
        if (!selectedChar) {
            toastr.warning('No character selected');
            return;
        }

        if (confirm(`Delete character "${selectedChar}" and all its reference images?`)) {
            delete extension_settings[extensionName].characterReference.characters[selectedChar];
            extension_settings[extensionName].characterReference.selectedCharacter = null;
            updateCharacterReferenceUI();
            updateStatusPanel();
            saveSettingsDebounced();
            toastr.success(`Character "${selectedChar}" deleted`);
        }
    });

    $('#char_reference_image_add_btn').on('click', function () {
        const selectedChar = extension_settings[extensionName].characterReference.selectedCharacter;
        if (!selectedChar) {
            toastr.warning('Please select a character first');
            return;
        }
        $('#char_reference_image_upload').trigger('click');
    });

    $('#char_reference_image_upload').on('change', async function (e) {
        const file = e.target.files[0];
        if (!file) return;

        const selectedChar = extension_settings[extensionName].characterReference.selectedCharacter;
        if (!selectedChar) return;

        try {
            const base64 = await fileToBase64(file);
            const resizedBase64 = await resizeImageForReference(base64, 1024);
            const id = generateImageId();
            const charData = extension_settings[extensionName].characterReference.characters[selectedChar];
            if (!charData.images) {
                charData.images = {};
            }
            charData.images[id] = {
                name: file.name,
                data: resizedBase64,
                active: true,
            };
            if (!charData.selectedImageId) {
                charData.selectedImageId = id;
            }
            updateCharacterImagesGrid();
            updateStatusPanel();
            saveSettingsDebounced();
            toastr.success('Reference image added (resized for NAI)');
        } catch (error) {
            toastr.error('Failed to add reference image');
        }

        $(this).val('');
    });

    // ===== 태그 매칭 이벤트 핸들러 =====
    $('#tag_matching_enabled').on('change', async function () {
        const enabled = $(this).prop('checked');
        extension_settings[extensionName].tagMatching.enabled = enabled;
        saveSettingsDebounced();
        
        // 활성화되면 태그 매처 초기화
        if (enabled && !tagMatcherReady) {
            await initializeTagMatcher();
        }
        updateTagMatchingUI();
    });

    $('#tag_matching_fuzzy_best').on('change', function () {
        extension_settings[extensionName].tagMatching.useFuzzyBest = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#tag_matching_keep_unmatched').on('change', function () {
        extension_settings[extensionName].tagMatching.keepUnmatched = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#tag_matching_show_stats').on('change', function () {
        extension_settings[extensionName].tagMatching.showStats = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#char_prompts_enabled').on('change', function () {
        extension_settings[extensionName].characterPrompts.enabled = $(this).prop('checked');
        updateStatusPanel();
        saveSettingsDebounced();
    });

    $('#char_prompts_position_enabled').on('change', function () {
        extension_settings[extensionName].characterPrompts.positionEnabled = $(this).prop('checked');
        updateCharacterPromptsList();
        saveSettingsDebounced();
    });

    $('#char_prompts_add').on('click', function () {
        const botName = getCurrentBotName();
        if (!botName) {
            toastr.warning('채팅을 열어 봇을 선택하세요');
            return;
        }
        
        const characters = getCurrentBotCharacterPrompts();
        const newChar = {
            id: generateCharacterPromptId(),
            name: '',
            prompt: '',
            negative: '',
            enabled: true,
            position: { x: 0.5, y: 0.5 },
        };
        characters.push(newChar);
        setCurrentBotCharacterPrompts(characters);
        updateCharacterPromptsList();
        updateStatusPanel();
        toastr.success('캐릭터 프롬프트가 추가되었습니다');
    });

    $('#char_prompts_clear').on('click', function () {
        const botName = getCurrentBotName();
        if (!botName) {
            toastr.warning('채팅을 열어 봇을 선택하세요');
            return;
        }
        
        if (confirm('현재 봇의 모든 캐릭터 프롬프트를 삭제하시겠습니까?')) {
            setCurrentBotCharacterPrompts([]);
            updateCharacterPromptsList();
            updateStatusPanel();
            toastr.success('캐릭터 프롬프트가 모두 삭제되었습니다');
        }
    });

    updateUI();
}

function onExtensionButtonClick() {
    const extensionsDrawer = $('#extensions-settings-button .drawer-toggle');

    if ($('#rm_extensions_block').hasClass('closedDrawer')) {
        extensionsDrawer.trigger('click');
    }

    setTimeout(() => {
        const container = $('#image_auto_generation_container');
        if (container.length) {
            $('#rm_extensions_block').animate(
                {
                    scrollTop:
                        container.offset().top -
                        $('#rm_extensions_block').offset().top +
                        $('#rm_extensions_block').scrollTop(),
                },
                500,
            );

            const drawerContent = container.find('.inline-drawer-content');
            const drawerHeader = container.find('.inline-drawer-header');

            if (drawerContent.is(':hidden') && drawerHeader.length) {
                drawerHeader.trigger('click');
            }
        }
    }, 500);
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

    if (settings.vibeTransfer.enabled && settings.vibeTransfer.selectedImageId) {
        const vibeImage = settings.vibeTransfer.images[settings.vibeTransfer.selectedImageId];
        if (vibeImage && vibeImage.active !== false) {
            extraParams.vibeTransfer = {
                image: vibeImage.data,
                strength: settings.vibeTransfer.defaultStrength,
                infoExtracted: settings.vibeTransfer.defaultInfoExtracted,
            };
            currentNAIStatus.vibeTransfer = vibeImage.name;
            currentNAIStatus.vibeTransferActive = true;
        } else if (vibeImage) {
            currentNAIStatus.vibeTransfer = vibeImage.name;
            currentNAIStatus.vibeTransferActive = false;
        }
    }

    if (settings.characterReference?.enabled) {
        const targetChar = settings.characterReference.selectedCharacter;

        if (targetChar && settings.characterReference.characters?.[targetChar]) {
            const charData = settings.characterReference.characters[targetChar];
            let selectedImageId = charData.selectedImageId;
            
            if (!selectedImageId && charData.images) {
                const imageIds = Object.keys(charData.images);
                for (const imgId of imageIds) {
                    if (charData.images[imgId].active !== false && charData.images[imgId].data) {
                        selectedImageId = imgId;
                        break;
                    }
                }
            }
            
            if (selectedImageId && charData.images && charData.images[selectedImageId]) {
                const selectedImage = charData.images[selectedImageId];
                if (selectedImage.active !== false && selectedImage.data) {
                    extraParams.characterReference = {
                        characterName: targetChar,
                        images: [selectedImage.data],
                        fidelity: charData.fidelity ?? settings.characterReference.defaultFidelity,
                        styleAware: charData.styleAware ?? settings.characterReference.defaultStyleAware,
                    };
                    currentNAIStatus.characterReference = targetChar;
                    currentNAIStatus.characterReferenceImage = selectedImage.name;
                }
            }
        }
    }

    const currentPreset = settings.presets[settings.currentPreset];
    if (currentPreset && currentPreset.negativePrompt) {
        extraParams.negativePrompt = currentPreset.negativePrompt;
    }

    if (settings.characterPrompts?.enabled === true) {
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
    const settings = extension_settings[extensionName];
    
    const presetName = settings.presets[settings.currentPreset]?.name || 'Default';
    $('#status_preset_value').text(presetName);
    $('#status_preset').toggleClass('active', settings.currentPreset !== 'default');
    $('#status_preset').toggleClass('inactive', settings.currentPreset === 'default');
    
    const vibeSelected = settings.vibeTransfer.enabled && settings.vibeTransfer.selectedImageId;
    let vibeName = 'Not set';
    let vibeActive = false;
    
    if (vibeSelected) {
        const vibeImage = settings.vibeTransfer.images[settings.vibeTransfer.selectedImageId];
        if (vibeImage) {
            const isImageActive = vibeImage.active !== false;
            vibeName = vibeImage.name || 'Selected';
            if (!isImageActive) {
                vibeName = `${vibeName} (OFF)`;
            }
            vibeActive = isImageActive;
        }
    }
    
    $('#status_vibe_value').text(vibeName).toggleClass('not-set', !vibeSelected);
    $('#status_vibe').toggleClass('active', vibeActive);
    $('#status_vibe').toggleClass('inactive', !vibeActive);
    $('#status_vibe').toggleClass('paused', vibeSelected && !vibeActive);
    
    const charEnabled = settings.characterReference.enabled && settings.characterReference.selectedCharacter;
    let charName = 'Not set';
    let charActive = false;
    
    if (charEnabled) {
        const charData = settings.characterReference.characters[settings.characterReference.selectedCharacter];
        if (charData) {
            const selectedImageId = charData.selectedImageId;
            if (selectedImageId && charData.images && charData.images[selectedImageId]) {
                const selectedImage = charData.images[selectedImageId];
                const isImageActive = selectedImage.active !== false;
                charName = `${settings.characterReference.selectedCharacter}: ${selectedImage.name || 'Image'}`;
                if (!isImageActive) {
                    charName = `${charName} (OFF)`;
                }
                charActive = isImageActive;
            } else {
                const activeImages = Object.values(charData.images || {}).filter(img => img.active !== false);
                charName = `${settings.characterReference.selectedCharacter} (${activeImages.length} images, none selected)`;
            }
        }
    }
    
    $('#status_charref_value').text(charName).toggleClass('not-set', !charEnabled);
    $('#status_charref').toggleClass('active', charActive);
    $('#status_charref').toggleClass('inactive', !charActive);
    $('#status_charref').toggleClass('paused', charEnabled && !charActive);
    
    const currentPreset = settings.presets[settings.currentPreset];
    const hasNegative = currentPreset && currentPreset.negativePrompt && currentPreset.negativePrompt.trim();
    const negativeText = hasNegative
        ? (currentPreset.negativePrompt.length > 20
            ? currentPreset.negativePrompt.substring(0, 20) + '...'
            : currentPreset.negativePrompt)
        : 'Not set';
    $('#status_negative_value').text(negativeText).toggleClass('not-set', !hasNegative);
    $('#status_negative').toggleClass('active', hasNegative);
    $('#status_negative').toggleClass('inactive', !hasNegative);
    
    const charPromptsEnabled = settings.characterPrompts?.enabled;
    let charPromptsText = 'Not set';
    let charPromptsActive = false;
    
    try {
        const charPrompts = getCurrentBotCharacterPrompts();
        const enabledCharPrompts = Array.isArray(charPrompts) 
            ? charPrompts.filter(c => c && c.enabled === true && c.prompt && c.prompt.trim())
            : [];
        
        if (charPromptsEnabled && enabledCharPrompts.length > 0) {
            charPromptsText = `${enabledCharPrompts.length} character(s)`;
            charPromptsActive = true;
        } else if (!charPromptsEnabled) {
            charPromptsText = 'Disabled';
        }
    } catch (e) {
        charPromptsText = 'Error';
    }
    
    $('#status_charprompt_value').text(charPromptsText).toggleClass('not-set', !charPromptsActive);
    $('#status_charprompt').toggleClass('active', charPromptsActive);
    $('#status_charprompt').toggleClass('inactive', !charPromptsActive);
    
    const anyActive = vibeActive || charActive || charPromptsActive || settings.currentPreset !== 'default';
    $('#nai_status_indicator')
        .toggleClass('active', anyActive)
        .toggleClass('inactive', !anyActive);
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
        
        if (extraParams.vibeTransfer) {
            const vibeData = extraParams.vibeTransfer;
            const imageData = stripBase64Header(vibeData.image);
            
            let strengthVal = parseFloat(vibeData.strength);
            if (isNaN(strengthVal)) strengthVal = 0.6;
            strengthVal = Math.min(1.0, Math.max(0.0, strengthVal));
            
            let infoVal = parseFloat(vibeData.infoExtracted);
            if (isNaN(infoVal)) infoVal = 1.0;
            infoVal = Math.min(1.0, Math.max(0.0, infoVal));
            
            vibeImages.push(imageData);
            vibeStrengths.push(strengthVal);
            vibeInfoExtracted.push(infoVal);
        }
        
        if (extraParams.characterReference) {
            const charData = extraParams.characterReference;
            for (const imgData of charData.images) {
                const imageData = stripBase64Header(imgData);
                
                let fidelityVal = parseFloat(charData.fidelity);
                if (isNaN(fidelityVal)) fidelityVal = 0.6;
                fidelityVal = Math.min(1.0, Math.max(0.0, fidelityVal));
                
                charRefImages.push(imageData);
                charRefStrengths.push(fidelityVal);
            }
            charRefStyleAware = charData.styleAware ?? false;
        }
        
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
        requestBody.parameters.reference_image_multiple = vibeImages;
        requestBody.parameters.reference_strength_multiple = vibeStrengths;
        requestBody.parameters.reference_information_extracted_multiple = vibeInfoExtracted;
    }
    
    if (charRefImages.length > 0) {
        requestBody.parameters.director_reference_images = charRefImages;
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
                <span data-i18n="Image Auto Generation">Image Auto Generation</span>
            </div>`);

            $('#auto_generation').off('click').on('click', onExtensionButtonClick);

            await loadSettings();

            await createSettings(settingsHtml);

            $('#extensions-settings-button').on('click', function () {
                setTimeout(() => {
                    updateUI();
                }, 200);
            });

            if (eventSource && event_types) {
                eventSource.on(event_types.CHAT_CHANGED, () => {
                    const newBotName = getCurrentBotName();
                    if (newBotName !== currentBotName) {
                        currentBotName = newBotName;
                        updateCharacterPromptsUI();
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
        }
    })();
});

function addMessageImageButton() {
    if (!$('#iagf_mes_button_style').length) {
        $('head').append(`
            <style id="iagf_mes_button_style">
                .iagf_img_btn {
                    cursor: pointer;
                    opacity: 0.7;
                    transition: opacity 0.2s ease, transform 0.15s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .iagf_img_btn:hover {
                    opacity: 1;
                }
                .iagf_img_btn.generating {
                    opacity: 1;
                    animation: iagf_pulse 0.8s infinite;
                }
                @keyframes iagf_pulse {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                }
            </style>
        `);
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
                    
                    // 메시지가 너무 길면 자르기
                    if (cleanContent.length > 1500) {
                        cleanContent = cleanContent.substring(0, 1500);
                    }
                    
                    if (!cleanContent) {
                        toastr.warning('Message content is empty');
                        return;
                    }
                    
                    // AI에게 이미지 프롬프트 생성 요청
                    const promptGenerationInstruction = `Based on the following message content, generate a single image prompt for stable diffusion. Output ONLY the prompt in English keywords/tags format, no explanations. Focus on visual elements, characters, scene, mood, and style.

Message content:
${cleanContent}

Output format: Just the prompt keywords separated by commas, like "1girl, long hair, blue eyes, standing, garden, sunset, detailed background"`;
                    
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
                            { length: 200 },
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
                    if (!Array.isArray(message.extra.image_swipes)) {
                        message.extra.image_swipes = [];
                    }
                    if (message.extra.image && !message.extra.image_swipes.includes(message.extra.image)) {
                        message.extra.image_swipes.push(message.extra.image);
                    }
                    
                    message.extra.image = result;
                    // 상세한 생성 정보 저장 (프롬프트 사용)
                    message.extra.title = extractedPrompt;
                    message.extra.inline_image = true;
                    message.extra.image_swipes.push(result);
                    
                    // UI 업데이트
                    appendMediaToMessage(message, $mes);
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
            // 确保设置对象和promptInjection对象都存在
            if (
                !extension_settings[extensionName] ||
                !extension_settings[extensionName].promptInjection ||
                !extension_settings[extensionName].promptInjection.enabled ||
                extension_settings[extensionName].insertType ===
                    INSERT_TYPE.DISABLED
            ) {
                return;
            }

            const prompt =
                extension_settings[extensionName].promptInjection.prompt;
            const depth =
                extension_settings[extensionName].promptInjection.depth || 0;
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
async function handleIncomingMessage() {
    // 确保设置对象存在
    if (
        !extension_settings[extensionName] ||
        extension_settings[extensionName].insertType === INSERT_TYPE.DISABLED
    ) {
        return;
    }

    const context = getContext();
    const message = context.chat[context.chat.length - 1];

    // 检查是否是AI消息
    if (!message || message.is_user) {
        return;
    }

    // 确保promptInjection对象和regex属性存在
    if (
        !extension_settings[extensionName].promptInjection ||
        !extension_settings[extensionName].promptInjection.regex
    ) {
        console.error('Prompt injection settings not properly initialized');
        return;
    }

    // 使用正则表达式search
    const imgTagRegex = regexFromString(
        extension_settings[extensionName].promptInjection.regex,
    );
    // const testRegex = regexFromString(extension_settings[extensionName].promptInjection.regex);
    let matches;
    if (imgTagRegex.global) {
        matches = [...message.mes.matchAll(imgTagRegex)];
    } else {
        const singleMatch = message.mes.match(imgTagRegex);
        matches = singleMatch ? [singleMatch] : [];
    }
    console.log(imgTagRegex, matches);
    if (matches.length > 0) {
        // 延迟执行图片生成，确保消息首先显示出来
        setTimeout(async () => {
            try {
                toastr.info(`Generating ${matches.length} images...`);
                const insertType = extension_settings[extensionName].insertType;

                // 在当前消息中插入图片
                // 初始化message.extra
                if (!message.extra) {
                    message.extra = {};
                }

                // 初始化image_swipes数组
                if (!Array.isArray(message.extra.image_swipes)) {
                    message.extra.image_swipes = [];
                }

                // 如果已有图片，添加到swipes
                if (
                    message.extra.image &&
                    !message.extra.image_swipes.includes(message.extra.image)
                ) {
                    message.extra.image_swipes.push(message.extra.image);
                }

                // 获取消息元素用于稍后更新
                const messageElement = $(
                    `.mes[mesid="${context.chat.length - 1}"]`,
                );

                // 处理每个匹配的图片标签
                for (const match of matches) {
                    const prompt =
                        typeof match?.[1] === 'string' ? match[1] : '';
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
                    if (insertType === INSERT_TYPE.INLINE) {
                        let imageUrl = result;
                        if (
                            typeof imageUrl === 'string' &&
                            imageUrl.trim().length > 0
                        ) {
                            // 添加图片到swipes数组
                            message.extra.image_swipes.push(imageUrl);

                            // 设置第一张图片为主图片，或更新为最新生成的图片
                            message.extra.image = imageUrl;
                            message.extra.title = prompt;
                            message.extra.inline_image = true;

                            // 更新UI
                            appendMediaToMessage(message, messageElement);

                            // 保存聊天记录
                            await context.saveChat();
                        }
                    } else if (insertType === INSERT_TYPE.REPLACE) {
                        let imageUrl = result;
                        if (
                            typeof imageUrl === 'string' &&
                            imageUrl.trim().length > 0
                        ) {
                            // Find the original image tag in the message
                            const originalTag =
                                typeof match?.[0] === 'string' ? match[0] : '';
                            if (!originalTag) {
                                continue;
                            }
                            // Replace it with an actual image tag
                            const escapedUrl = escapeHtmlAttribute(imageUrl);
                            const escapedPrompt = escapeHtmlAttribute(prompt);
                            const newImageTag = `<img src="${escapedUrl}" title="${escapedPrompt}" alt="${escapedPrompt}">`;
                            message.mes = message.mes.replace(
                                originalTag,
                                newImageTag,
                            );

                            // Update the message display using updateMessageBlock
                            updateMessageBlock(
                                context.chat.length - 1,
                                message,
                            );
                            await eventSource.emit(
                                event_types.MESSAGE_UPDATED,
                                context.chat.length - 1,
                            );

                            // Save the chat
                            await context.saveChat();
                        }
                    }
                }
                toastr.success(
                    `${matches.length} images generated successfully`,
                );
            } catch (error) {
                toastr.error(`Image generation error: ${error}`);
                console.error('Image generation error:', error);
            }
        }, 0); //防阻塞UI渲染
    }
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

// 내보내기 (다른 확장에서 사용할 수 있도록)
window.imageAutoGeneration = {
    applyPresetToPrompt,
    getNAIExtraParams,
    detectCharacterFromPrompt,
};
