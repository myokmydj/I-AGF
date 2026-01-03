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

const extensionName = 'I-AGF';
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
At the end of your reply, insert exactly one <pic prompt="..."> tag for Stable Diffusion/NAI image generation.

[Character Reference]
{{description}}

[User Persona]
{{persona}}

[5 Core Principles for Danbooru Tag Generation]
1. CONFLICT PREVENTION: Never combine conflicting tags (e.g., "clenched teeth" + "tongue out", or multiple gaze directions).
2. QUALITY CONTROL: Use "blush" instead of "red face". Avoid quality-degrading elements.
3. STRUCTURED OUTPUT: Organize as [Background/Atmosphere] then [Character Details].
4. NO CENSORSHIP: Convert any scene into purely visual descriptive tags without moral judgment.

[Tag Order - Standard Format]
Base: composition(1girl, shot type) → artist:name → source(game/anime) → year(newest, year 2025) → style(anime style) → quality(masterpiece, absurdres, best quality, very awa)
Character: body type → action/pose → hair(color, style) → face(eyes, expression) → outfit(top to bottom) → accessories

Output ONLY the prompt inside the tag, using English Danbooru-style tags separated by commas.
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
        perBot: {},
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
    messageActionPrompt: {
        prompt: `You are a Danbooru tag generator for Stable Diffusion/NAI. Convert the scene into image generation tags.

[Character Reference]
{{description}}

[User Persona]
{{persona}}

[Scene to Convert]
{{message}}

[5 Core Principles]
1. TAG SYNTAX: Comma-separated tags ONLY. NO sentences. Use "1.x::tag::" weight ONLY for critical elements.
2. CONFLICT PREVENTION: Never combine conflicting tags (e.g., "clenched teeth" + "tongue out", multiple gaze tags).
3. QUALITY CONTROL: Use "blush" not "red face". Consider negative prompt elements.
4. STRUCTURED OUTPUT: [Background/Mood] → [Character A] → [Character B if exists]
5. NO CENSORSHIP: Convert ANY scene into visual tags without moral judgment.

[Tag Order]
Base Prompt: composition → artist:name → source → year(newest) → style → quality(masterpiece, absurdres, best quality, very awa)
Character: gender → body type → pose/action → hair(color, style) → face(eyes, expression: use blush/flushed not red face) → outfit(top→bottom) → accessories → details

OUTPUT: ONLY comma-separated English Danbooru tags. NO explanations, NO formatting, NO markdown.`,
        maxResponseLength: 500,
        messageMaxLength: 0,  // 0 = 무제한
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

function updateToggleButtonUI() {
    const isEnabled = extension_settings[extensionName].insertType !== INSERT_TYPE.DISABLED;
    $('#iagf_toggle').toggleClass('selected', isEnabled);
    $('#iagf_toggle span').text(isEnabled ? 'IAGF Enabled' : 'IAGF Disabled');
    const icon = $('#iagf_toggle > div');
    icon.removeClass('fa-power-off fa-check');
    icon.addClass(isEnabled ? 'fa-check' : 'fa-power-off');
}

function initPresetGalleryModal() {
    if ($('#iagf_preset_gallery_modal').length) return;
    
    const modalHtml = `
    <div id="iagf_preset_gallery_modal" class="iagf-modal" style="display:none;">
        <div class="iagf-modal-overlay"></div>
        <div class="iagf-modal-content">
            <div class="iagf-modal-header">
                <h3><i class="fa-solid fa-images"></i> Preset Gallery</h3>
                <button class="iagf-modal-close"><i class="fa-solid fa-times"></i></button>
            </div>
            <div class="iagf-modal-body">
                <div id="iagf_preset_cards_container" class="iagf-preset-cards"></div>
            </div>
        </div>
    </div>
    <style>
        .iagf-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .iagf-modal-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
        }
        .iagf-modal-content {
            position: relative;
            background: var(--SmartThemeBlurTintColor, #1a1a1a);
            border-radius: 10px;
            max-width: 800px;
            width: 90%;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
        }
        .iagf-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 20px;
            border-bottom: 1px solid var(--SmartThemeBorderColor, #444);
        }
        .iagf-modal-header h3 {
            margin: 0;
            color: var(--SmartThemeBodyColor, #fff);
        }
        .iagf-modal-close {
            background: none;
            border: none;
            color: var(--SmartThemeBodyColor, #fff);
            cursor: pointer;
            font-size: 1.2em;
            padding: 5px;
        }
        .iagf-modal-close:hover {
            color: var(--SmartThemeQuoteColor, #f66);
        }
        .iagf-modal-body {
            padding: 20px;
            overflow-y: auto;
            flex: 1;
        }
        .iagf-preset-cards {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 15px;
        }
        .iagf-preset-card {
            background: var(--SmartThemeBlurTintColor, #2a2a2a);
            border: 2px solid var(--SmartThemeBorderColor, #444);
            border-radius: 8px;
            padding: 10px;
            display: flex;
            flex-direction: column;
            transition: all 0.2s;
        }
        .iagf-preset-card.active {
            border-color: var(--SmartThemeQuoteColor, #4a9);
            box-shadow: 0 0 10px rgba(68, 170, 153, 0.3);
        }
        .iagf-preset-card-preview {
            width: 100%;
            height: 150px;
            background: var(--SmartThemeBorderColor, #333);
            border-radius: 5px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 10px;
            overflow: hidden;
        }
        .iagf-preset-card-preview img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .iagf-preset-card-preview .no-preview {
            color: var(--SmartThemeBodyColor, #888);
            font-size: 0.9em;
            text-align: center;
        }
        .iagf-preset-card-info {
            flex: 1;
        }
        .iagf-preset-card-name {
            font-weight: bold;
            color: var(--SmartThemeBodyColor, #fff);
            margin-bottom: 5px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .iagf-preset-card-name input[type="checkbox"] {
            width: 18px;
            height: 18px;
            cursor: pointer;
        }
        .iagf-preset-card-actions {
            display: flex;
            gap: 5px;
            margin-top: 10px;
        }
        .iagf-preset-card-actions button {
            flex: 1;
            padding: 5px 8px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
            transition: all 0.2s;
        }
        .iagf-btn-preview {
            background: var(--SmartThemeQuoteColor, #4a9);
            color: white;
        }
        .iagf-btn-preview:hover {
            filter: brightness(1.2);
        }
        .iagf-btn-preview:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .iagf-btn-preview.generating {
            animation: pulse 1s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
    </style>
    `;
    $('body').append(modalHtml);
    
    $('#iagf_preset_gallery_modal .iagf-modal-overlay, #iagf_preset_gallery_modal .iagf-modal-close').on('click', closePresetGallery);
}

function openPresetGallery() {
    renderPresetCards();
    $('#iagf_preset_gallery_modal').fadeIn(200);
}

function closePresetGallery() {
    $('#iagf_preset_gallery_modal').fadeOut(200);
}

function renderPresetCards() {
    const settings = extension_settings[extensionName];
    const container = $('#iagf_preset_cards_container');
    container.empty();
    
    for (const [key, preset] of Object.entries(settings.presets)) {
        const isActive = settings.currentPreset === key;
        const previewImage = preset.previewImage || null;
        
        const cardHtml = `
            <div class="iagf-preset-card ${isActive ? 'active' : ''}" data-preset-key="${key}">
                <div class="iagf-preset-card-preview">
                    ${previewImage 
                        ? `<img src="${previewImage}" alt="${escapeHtmlAttribute(preset.name)}">` 
                        : '<div class="no-preview"><i class="fa-solid fa-image"></i><br>No Preview</div>'}
                </div>
                <div class="iagf-preset-card-info">
                    <div class="iagf-preset-card-name">
                        <input type="checkbox" class="preset-checkbox" ${isActive ? 'checked' : ''} data-preset-key="${key}">
                        <span>${escapeHtmlAttribute(preset.name)}</span>
                    </div>
                </div>
                <div class="iagf-preset-card-actions">
                    <button class="iagf-btn-preview" data-preset-key="${key}">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> Generate Preview
                    </button>
                </div>
            </div>
        `;
        container.append(cardHtml);
    }
    
    container.find('.preset-checkbox').on('change', function() {
        const presetKey = $(this).data('preset-key');
        if ($(this).prop('checked')) {
            settings.currentPreset = presetKey;
            saveSettingsDebounced();
            updatePresetUI();
            updateStatusPanel();
            renderPresetCards();
            toastr.success(`Preset "${settings.presets[presetKey].name}" activated`);
        }
    });
    
    container.find('.iagf-btn-preview').on('click', async function() {
        const presetKey = $(this).data('preset-key');
        const btn = $(this);
        
        if (btn.prop('disabled')) return;
        
        btn.prop('disabled', true).addClass('generating');
        btn.html('<i class="fa-solid fa-spinner fa-spin"></i> Generating...');
        
        try {
            await generatePresetPreview(presetKey);
            renderPresetCards();
            toastr.success('Preview generated!');
        } catch (error) {
            console.error('Preview generation failed:', error);
            toastr.error('Failed to generate preview');
        } finally {
            btn.prop('disabled', false).removeClass('generating');
            btn.html('<i class="fa-solid fa-wand-magic-sparkles"></i> Generate Preview');
        }
    });
}

async function generatePresetPreview(presetKey) {
    const settings = extension_settings[extensionName];
    const preset = settings.presets[presetKey];
    
    if (!preset) return;
    
    const samplePrompt = 'a beautiful anime girl with long flowing hair, detailed eyes, soft lighting, portrait';
    const finalPrompt = ((preset.prefixPrompt || '') + ' ' + samplePrompt + ' ' + (preset.suffixPrompt || '')).trim();
    const negativePrompt = preset.negativePrompt || '';
    
    try {
        // 직접 NAI API 호출하여 이미지 생성
        const imageData = await generatePreviewImage(finalPrompt, negativePrompt);
        
        if (imageData) {
            preset.previewImage = imageData.startsWith('data:') ? imageData : 'data:image/png;base64,' + imageData;
            saveSettingsDebounced();
        } else {
            throw new Error('No image data returned');
        }
    } catch (error) {
        console.error('Failed to generate preset preview:', error);
        throw error;
    }
}

async function generatePreviewImage(prompt, negativePrompt) {
    const sdSettings = extension_settings.sd || {};
    
    const model = sdSettings.model || 'nai-diffusion-4-5-full';
    const sampler = sdSettings.sampler || 'k_euler_ancestral';
    const scheduler = sdSettings.scheduler || 'native';
    const steps = Math.min(sdSettings.steps || 28, 50);
    const scale = parseFloat(sdSettings.scale) || 5.0;
    // 미리보기용 작은 이미지 크기
    const width = 512;
    const height = 768;
    const seed = Math.floor(Math.random() * 2147483647);
    
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
    
    let response;
    
    try {
        // 플러그인 API 시도
        response = await fetch('/api/plugins/nai-reference-image/generate', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(requestBody),
        });
        
        if (response.status === 404) {
            throw new Error('Plugin not available');
        }
    } catch (pluginError) {
        // 기본 NAI API로 폴백
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
    
    if (!imageData) {
        throw new Error('NAI API returned empty response');
    }
    
    return imageData;
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
    $('#auto_generation').toggleClass(
        'selected',
        extension_settings[extensionName].insertType !== INSERT_TYPE.DISABLED,
    );
    updateToggleButtonUI();

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

        // Message Action Prompt UI 업데이트
        $('#message_action_prompt').val(
            extension_settings[extensionName].messageActionPrompt?.prompt || defaultSettings.messageActionPrompt.prompt,
        );
        $('#message_action_max_response_length').val(
            extension_settings[extensionName].messageActionPrompt?.maxResponseLength || defaultSettings.messageActionPrompt.maxResponseLength,
        );
        $('#message_action_message_max_length').val(
            extension_settings[extensionName].messageActionPrompt?.messageMaxLength ?? defaultSettings.messageActionPrompt.messageMaxLength,
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

function updateCharacterReferenceUI() {
    const settings = extension_settings[extensionName];
    const charSettings = settings.characterReference;
    const botName = getCurrentBotName();

    $('#char_reference_enabled').prop('checked', charSettings.enabled);
    
    // 현재 봇 이름 표시
    const botNameDisplay = botName || 'No bot selected';
    $('#current_char_ref_bot_name').text(botNameDisplay);

    updateCharacterSelectUI();
    updateCharacterImagesGrid();
    updateCharacterSettingsUI();
}

function updateCharacterSelectUI(selectCharName = null) {
    const botData = getCurrentBotCharacterReferences();
    const select = $('#char_reference_select');
    const currentVal = selectCharName || select.val();
    
    select.empty();
    select.append('<option value="">-- 캐릭터 선택 --</option>');
    
    if (!botData || !botData.characters) return;
    
    for (const charName of Object.keys(botData.characters)) {
        const isActive = botData.activeCharacter === charName;
        select.append(`<option value="${escapeHtmlAttribute(charName)}">${escapeHtmlAttribute(charName)}${isActive ? ' ★' : ''}</option>`);
    }
    
    // 선택값 복원
    if (currentVal && botData.characters[currentVal]) {
        select.val(currentVal);
    }
}

function updateCharacterImagesGrid() {
    const container = $('#char_reference_images_container');
    container.empty();
    
    const botName = getCurrentBotName();
    const botData = getCurrentBotCharacterReferences();
    
    if (!botName) {
        container.append('<p class="hint">채팅을 열어 봇을 선택하세요</p>');
        return;
    }
    
    const selectedChar = $('#char_reference_select').val();
    if (!selectedChar || !botData?.characters?.[selectedChar]) {
        container.append('<p class="hint">캐릭터를 선택하거나 추가하세요</p>');
        return;
    }
    
    const charData = botData.characters[selectedChar];
    const isCharActive = botData.activeCharacter === selectedChar;
    
    if (!charData.images || charData.images.length === 0) {
        container.append('<p class="hint">이미지를 추가하세요</p>');
        return;
    }
    
    charData.images.forEach((img) => {
        const isSelected = charData.activeImageId === img.id;
        const itemHtml = `
            <div class="image_grid_item ${isSelected ? 'selected' : ''}" data-id="${img.id}">
                <img src="${img.data}" alt="${escapeHtmlAttribute(img.name)}" title="${escapeHtmlAttribute(img.name)}">
                <button class="delete_btn" data-id="${img.id}" title="삭제"><i class="fa-solid fa-xmark"></i></button>
                ${isSelected ? '<span class="selected_badge">선택됨</span>' : ''}
            </div>
        `;
        container.append(itemHtml);
    });
    
    // 이미지 클릭 - 선택
    container.find('.image_grid_item').on('click', function(e) {
        if ($(e.target).closest('.delete_btn').length) return;
        
        const id = $(this).data('id');
        if (charData.activeImageId === id) {
            charData.activeImageId = null;
        } else {
            charData.activeImageId = id;
        }
        setCurrentBotCharacterReferences(botData);
        updateCharacterImagesGrid();
        updateStatusPanel();
    });
    
    // 삭제 버튼
    container.find('.delete_btn').on('click', function(e) {
        e.stopPropagation();
        const id = $(this).data('id');
        const index = charData.images.findIndex(img => img.id === id);
        if (index !== -1) {
            if (charData.activeImageId === id) {
                charData.activeImageId = null;
            }
            charData.images.splice(index, 1);
            setCurrentBotCharacterReferences(botData);
            updateCharacterImagesGrid();
            updateStatusPanel();
        }
    });
}

function updateCharacterSettingsUI() {
    const botData = getCurrentBotCharacterReferences();
    const selectedChar = $('#char_reference_select').val();
    
    if (!botData || !selectedChar || !botData.characters?.[selectedChar]) {
        $('#char_ref_fidelity').val(0.6);
        $('#char_ref_style_aware').prop('checked', false);
        $('#char_ref_activate_btn').removeClass('active').find('span').text('활성화');
        return;
    }
    
    const charData = botData.characters[selectedChar];
    const isActive = botData.activeCharacter === selectedChar;
    
    $('#char_ref_fidelity').val(charData.fidelity ?? 0.6);
    $('#char_ref_style_aware').prop('checked', charData.styleAware ?? false);
    $('#char_ref_activate_btn')
        .toggleClass('active', isActive)
        .find('span').text(isActive ? '활성화됨 ★' : '활성화');
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
            // perBot 구조 초기화 확인
            if (!extension_settings[extensionName].characterReference.perBot) {
                extension_settings[extensionName].characterReference.perBot = {};
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

        // messageActionPrompt 초기화
        if (!extension_settings[extensionName].messageActionPrompt) {
            extension_settings[extensionName].messageActionPrompt = defaultSettings.messageActionPrompt;
        } else {
            for (const key in defaultSettings.messageActionPrompt) {
                if (extension_settings[extensionName].messageActionPrompt[key] === undefined) {
                    extension_settings[extensionName].messageActionPrompt[key] = defaultSettings.messageActionPrompt[key];
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

    // Message Action Prompt 설정
    $('#message_action_prompt').on('input', function () {
        extension_settings[extensionName].messageActionPrompt.prompt = $(this).val();
        saveSettingsDebounced();
    });

    $('#message_action_max_response_length').on('input', function () {
        const value = parseInt(String($(this).val()));
        extension_settings[extensionName].messageActionPrompt.maxResponseLength = isNaN(value) ? 500 : value;
        saveSettingsDebounced();
    });

    $('#message_action_message_max_length').on('input', function () {
        const value = parseInt(String($(this).val()));
        extension_settings[extensionName].messageActionPrompt.messageMaxLength = isNaN(value) ? 0 : value;
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
        updateStatusPanel();
        saveSettingsDebounced();
    });

    // ===== 캐릭터 레퍼런스 이벤트 핸들러 (레거시 구조) =====
    
    // 캐릭터 선택 변경
    $('#char_reference_select').on('change', function () {
        updateCharacterImagesGrid();
        updateCharacterSettingsUI();
    });
    
    // 캐릭터 추가
    $('#char_add_btn').on('click', function () {
        const botName = getCurrentBotName();
        if (!botName) {
            toastr.warning('채팅을 열어 봇을 선택하세요');
            return;
        }
        
        const charName = prompt('캐릭터 이름을 입력하세요:');
        if (!charName || !charName.trim()) return;
        
        if (addCharacterToBot(charName.trim())) {
            updateCharacterSelectUI(charName.trim());
            updateCharacterImagesGrid();
            updateCharacterSettingsUI();
            toastr.success(`캐릭터 "${charName.trim()}" 추가됨`);
        }
    });
    
    // 캐릭터 삭제
    $('#char_delete_btn').on('click', function () {
        const selectedChar = $('#char_reference_select').val();
        if (!selectedChar) {
            toastr.warning('삭제할 캐릭터를 선택하세요');
            return;
        }
        
        if (!confirm(`"${selectedChar}" 캐릭터와 모든 이미지를 삭제하시겠습니까?`)) return;
        
        const botData = getCurrentBotCharacterReferences();
        if (botData && botData.characters[selectedChar]) {
            delete botData.characters[selectedChar];
            if (botData.activeCharacter === selectedChar) {
                botData.activeCharacter = null;
            }
            setCurrentBotCharacterReferences(botData);
            updateCharacterSelectUI();
            updateCharacterImagesGrid();
            updateCharacterSettingsUI();
            updateStatusPanel();
            toastr.success(`캐릭터 "${selectedChar}" 삭제됨`);
        }
    });
    
    // 캐릭터 활성화 토글
    $('#char_ref_activate_btn').on('click', function () {
        const selectedChar = $('#char_reference_select').val();
        if (!selectedChar) {
            toastr.warning('캐릭터를 먼저 선택하세요');
            return;
        }
        
        const botData = getCurrentBotCharacterReferences();
        if (!botData) return;
        
        const charData = botData.characters[selectedChar];
        if (!charData || !charData.activeImageId) {
            toastr.warning('이미지를 먼저 선택하세요');
            return;
        }
        
        // 토글
        if (botData.activeCharacter === selectedChar) {
            botData.activeCharacter = null;
        } else {
            botData.activeCharacter = selectedChar;
        }
        
        setCurrentBotCharacterReferences(botData);
        updateCharacterSelectUI();
        updateCharacterSettingsUI();
        updateStatusPanel();
    });
    
    // Fidelity 변경
    $('#char_ref_fidelity').on('input', function () {
        const selectedChar = $('#char_reference_select').val();
        if (!selectedChar) return;
        
        const botData = getCurrentBotCharacterReferences();
        if (botData && botData.characters[selectedChar]) {
            botData.characters[selectedChar].fidelity = parseFloat($(this).val()) || 0.6;
            setCurrentBotCharacterReferences(botData);
        }
    });
    
    // Style Aware 변경
    $('#char_ref_style_aware').on('change', function () {
        const selectedChar = $('#char_reference_select').val();
        if (!selectedChar) return;
        
        const botData = getCurrentBotCharacterReferences();
        if (botData && botData.characters[selectedChar]) {
            botData.characters[selectedChar].styleAware = $(this).prop('checked');
            setCurrentBotCharacterReferences(botData);
        }
    });
    
    // 이미지 추가 버튼
    $('#char_image_add_btn').on('click', function () {
        const selectedChar = $('#char_reference_select').val();
        if (!selectedChar) {
            toastr.warning('캐릭터를 먼저 선택하세요');
            return;
        }
        $('#char_reference_image_upload').trigger('click');
    });

    $('#char_reference_image_upload').on('change', async function (e) {
        const file = e.target.files[0];
        if (!file) return;

        const selectedChar = $('#char_reference_select').val();
        if (!selectedChar) {
            toastr.warning('캐릭터를 먼저 선택하세요');
            $(this).val('');
            return;
        }

        try {
            const base64 = await fileToBase64(file);
            const resizedBase64 = await resizeImageForReference(base64, 1024);
            
            addImageToCharacter(selectedChar, resizedBase64, file.name);
            
            updateCharacterImagesGrid();
            updateStatusPanel();
            toastr.success('이미지가 추가되었습니다');
        } catch (error) {
            toastr.error('이미지 추가 실패');
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
        // 레거시 구조 (캐릭터 > 이미지) perBot
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
            if (isImageActive) {
                vibeName = '1 image';
                vibeActive = true;
            } else {
                vibeName = '1 image (OFF)';
            }
        }
    }
    
    $('#status_vibe_value').text(vibeName).toggleClass('not-set', !vibeSelected);
    $('#status_vibe').toggleClass('active', vibeActive);
    $('#status_vibe').toggleClass('inactive', !vibeActive);
    $('#status_vibe').toggleClass('paused', vibeSelected && !vibeActive);
    
    // 레거시 구조 (캐릭터 > 이미지) perBot
    const charRefEnabled = settings.characterReference.enabled;
    const botData = getCurrentBotCharacterReferences();
    let charName = 'Not set';
    let charActive = false;
    let hasCharRef = false;
    
    if (charRefEnabled && botData && botData.activeCharacter) {
        const charData = botData.characters[botData.activeCharacter];
        if (charData && charData.activeImageId) {
            const activeImage = charData.images.find(img => img.id === charData.activeImageId);
            if (activeImage) {
                hasCharRef = true;
                charName = '1 character';
                charActive = true;
            }
        }
    } else if (charRefEnabled && botData && botData.characters) {
        const charCount = Object.keys(botData.characters).length;
        if (charCount > 0) {
            hasCharRef = true;
            charName = `${charCount} character(s) (none active)`;
        }
    }
    
    $('#status_charref_value').text(charName).toggleClass('not-set', !hasCharRef);
    $('#status_charref').toggleClass('active', charActive);
    $('#status_charref').toggleClass('inactive', !charActive);
    $('#status_charref').toggleClass('paused', hasCharRef && !charActive);
    
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

            $('#auto_generation').off('click').on('click', onExtensionButtonClick);
            $('#iagf_toggle').off('click').on('click', onToggleExtension);
            $('#iagf_preset_gallery').off('click').on('click', openPresetGallery);
            updateToggleButtonUI();
            initPresetGalleryModal();

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
                /* Image regeneration buttons */
                .iagf-regen-container {
                    position: absolute;
                    bottom: 4px;
                    left: 50%;
                    transform: translateX(-50%);
                    display: flex;
                    justify-content: center;
                    gap: 4px;
                    opacity: 0;
                    transition: opacity 0.2s ease;
                    z-index: 10;
                }
                .mes_img_container:hover .iagf-regen-container,
                .mes_img_wrapper:hover .iagf-regen-container,
                .mes_block:hover .iagf-regen-container,
                .iagf-regen-container:hover {
                    opacity: 1;
                }
                .iagf-regen-btn {
                    background: rgba(0, 0, 0, 0.7);
                    border: 1px solid rgba(255, 255, 255, 0.3);
                    color: rgba(255, 255, 255, 0.8);
                    padding: 3px 8px;
                    font-size: 10px;
                    border-radius: 3px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 3px;
                    transition: all 0.15s ease;
                    white-space: nowrap;
                }
                .iagf-regen-btn:hover {
                    background: rgba(0, 0, 0, 0.9);
                    border-color: rgba(255, 255, 255, 0.5);
                    color: rgba(255, 255, 255, 1);
                }
                .iagf-regen-btn:disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
                }
                .iagf-regen-btn.generating {
                    animation: iagf_pulse 0.8s infinite;
                }
                .iagf-regen-btn i {
                    font-size: 9px;
                }
                /* Regeneration edit modal */
                .iagf-regen-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    z-index: 10000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .iagf-regen-modal-overlay {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.7);
                }
                .iagf-regen-modal-content {
                    position: relative;
                    background: #1a1a1a;
                    border: 1px solid #333;
                    border-radius: 6px;
                    width: 90%;
                    max-width: 500px;
                    max-height: 80vh;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
                }
                .iagf-regen-modal-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 10px 14px;
                    border-bottom: 1px solid #333;
                }
                .iagf-regen-modal-header h4 {
                    margin: 0;
                    color: #ccc;
                    font-size: 13px;
                    font-weight: 500;
                }
                .iagf-regen-modal-close {
                    background: none;
                    border: none;
                    color: #888;
                    cursor: pointer;
                    font-size: 14px;
                    padding: 2px 6px;
                }
                .iagf-regen-modal-close:hover {
                    color: #fff;
                }
                .iagf-regen-modal-body {
                    padding: 14px;
                    overflow-y: auto;
                    flex: 1;
                }
                .iagf-regen-field {
                    margin-bottom: 12px;
                }
                .iagf-regen-field label {
                    display: block;
                    color: #999;
                    font-size: 11px;
                    margin-bottom: 4px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .iagf-regen-field input,
                .iagf-regen-field textarea,
                .iagf-regen-field select {
                    width: 100%;
                    background: #222;
                    border: 1px solid #444;
                    color: #ddd;
                    padding: 6px 8px;
                    font-size: 12px;
                    border-radius: 3px;
                    box-sizing: border-box;
                }
                .iagf-regen-field textarea {
                    min-height: 60px;
                    resize: vertical;
                    font-family: inherit;
                }
                .iagf-regen-field input:focus,
                .iagf-regen-field textarea:focus,
                .iagf-regen-field select:focus {
                    outline: none;
                    border-color: #666;
                }
                .iagf-regen-row {
                    display: flex;
                    gap: 10px;
                }
                .iagf-regen-row .iagf-regen-field {
                    flex: 1;
                }
                .iagf-regen-modal-footer {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                    padding: 10px 14px;
                    border-top: 1px solid #333;
                }
                .iagf-regen-modal-btn {
                    background: #333;
                    border: 1px solid #444;
                    color: #ccc;
                    padding: 6px 14px;
                    font-size: 11px;
                    border-radius: 3px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                }
                .iagf-regen-modal-btn:hover {
                    background: #444;
                    color: #fff;
                }
                .iagf-regen-modal-btn.primary {
                    background: #444;
                    border-color: #555;
                }
                .iagf-regen-modal-btn.primary:hover {
                    background: #555;
                }
                .iagf-regen-modal-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                /* Tag autocomplete styles */
                .iagf-autocomplete-container {
                    position: relative;
                }
                .iagf-autocomplete-list {
                    position: absolute;
                    top: 100%;
                    left: 0;
                    right: 0;
                    max-height: 150px;
                    overflow-y: auto;
                    background: #1a1a1a;
                    border: 1px solid #444;
                    border-top: none;
                    border-radius: 0 0 3px 3px;
                    z-index: 10001;
                    display: none;
                }
                .iagf-autocomplete-list.visible {
                    display: block;
                }
                .iagf-autocomplete-item {
                    padding: 4px 8px;
                    font-size: 11px;
                    color: #ccc;
                    cursor: pointer;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .iagf-autocomplete-item:hover,
                .iagf-autocomplete-item.selected {
                    background: #333;
                    color: #fff;
                }
                .iagf-autocomplete-item .tag-count {
                    color: #666;
                    font-size: 10px;
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
                    // 봇 변경 시 캐릭터 레퍼런스 UI 업데이트
                    setTimeout(() => {
                        currentBotName = getCurrentBotName();
                        updateCharacterReferenceUI();
                        updateCharacterPromptsUI();
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

// 재생성 모달 초기화
function initRegenModal() {
    if ($('#iagf_regen_modal').length) return;
    
    const modalHtml = `
    <div id="iagf_regen_modal" class="iagf-regen-modal" style="display:none;">
        <div class="iagf-regen-modal-overlay"></div>
        <div class="iagf-regen-modal-content">
            <div class="iagf-regen-modal-header">
                <h4><i class="fa-solid fa-sliders"></i> Edit & Regenerate</h4>
                <button class="iagf-regen-modal-close"><i class="fa-solid fa-times"></i></button>
            </div>
            <div class="iagf-regen-modal-body">
                <div class="iagf-regen-field">
                    <label>Prompt</label>
                    <textarea id="iagf_regen_prompt" rows="3"></textarea>
                </div>
                <div class="iagf-regen-field">
                    <label>Negative Prompt</label>
                    <textarea id="iagf_regen_negative" rows="2"></textarea>
                </div>
                <div class="iagf-regen-row">
                    <div class="iagf-regen-field">
                        <label>Width</label>
                        <input type="number" id="iagf_regen_width" min="64" max="2048" step="64">
                    </div>
                    <div class="iagf-regen-field">
                        <label>Height</label>
                        <input type="number" id="iagf_regen_height" min="64" max="2048" step="64">
                    </div>
                </div>
                <div class="iagf-regen-row">
                    <div class="iagf-regen-field">
                        <label>Steps</label>
                        <input type="number" id="iagf_regen_steps" min="1" max="50">
                    </div>
                    <div class="iagf-regen-field">
                        <label>Scale (CFG)</label>
                        <input type="number" id="iagf_regen_scale" min="1" max="30" step="0.1">
                    </div>
                </div>
                <div class="iagf-regen-row">
                    <div class="iagf-regen-field">
                        <label>Seed (-1 = random)</label>
                        <input type="number" id="iagf_regen_seed" min="-1">
                    </div>
                    <div class="iagf-regen-field">
                        <label>Sampler</label>
                        <select id="iagf_regen_sampler">
                            <option value="k_euler_ancestral">Euler Ancestral</option>
                            <option value="k_euler">Euler</option>
                            <option value="k_dpmpp_2s_ancestral">DPM++ 2S Ancestral</option>
                            <option value="k_dpmpp_2m_sde">DPM++ 2M SDE</option>
                            <option value="k_dpmpp_sde">DPM++ SDE</option>
                        </select>
                    </div>
                </div>
                <div class="iagf-regen-row">
                    <div class="iagf-regen-field">
                        <label>CFG Rescale</label>
                        <input type="number" id="iagf_regen_cfg_rescale" min="0" max="1" step="0.01" value="0">
                    </div>
                    <div class="iagf-regen-field">
                        <label>Variety+</label>
                        <select id="iagf_regen_variety">
                            <option value="false">Off</option>
                            <option value="true">On</option>
                        </select>
                    </div>
                </div>
            </div>
            <div class="iagf-regen-modal-footer">
                <button class="iagf-regen-modal-btn" id="iagf_regen_cancel">Cancel</button>
                <button class="iagf-regen-modal-btn primary" id="iagf_regen_generate"><i class="fa-solid fa-rotate"></i> Regenerate</button>
            </div>
        </div>
    </div>
    `;
    $('body').append(modalHtml);
    
    // 모달 이벤트 바인딩
    $('#iagf_regen_modal .iagf-regen-modal-overlay, #iagf_regen_modal .iagf-regen-modal-close, #iagf_regen_cancel').on('click', closeRegenModal);
    $('#iagf_regen_generate').on('click', executeRegeneration);
}

// 현재 편집 중인 메시지 정보 저장
let currentRegenMesId = null;

function openRegenModal(mesId, genParams) {
    initRegenModal();
    currentRegenMesId = mesId;
    
    // 필드에 값 채우기
    $('#iagf_regen_prompt').val(genParams.prompt || '');
    $('#iagf_regen_negative').val(genParams.negativePrompt || '');
    $('#iagf_regen_width').val(genParams.width || 832);
    $('#iagf_regen_height').val(genParams.height || 1216);
    $('#iagf_regen_steps').val(genParams.steps || 28);
    $('#iagf_regen_scale').val(genParams.scale || 5.0);
    $('#iagf_regen_seed').val(-1); // 기본적으로 랜덤 시드
    $('#iagf_regen_sampler').val(genParams.sampler || 'k_euler_ancestral');
    $('#iagf_regen_cfg_rescale').val(genParams.cfgRescale ?? 0);
    $('#iagf_regen_variety').val(genParams.variety ? 'true' : 'false');
    
    $('#iagf_regen_modal').fadeIn(150);
}

function closeRegenModal() {
    $('#iagf_regen_modal').fadeOut(150);
    currentRegenMesId = null;
}

async function executeRegeneration() {
    if (currentRegenMesId === null) return;
    
    const $btn = $('#iagf_regen_generate');
    $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Generating...');
    
    try {
        const context = getContext();
        const message = context.chat[currentRegenMesId];
        
        if (!message) {
            toastr.error('Message not found');
            return;
        }
        
        // 모달에서 값 가져오기
        const prompt = $('#iagf_regen_prompt').val().trim();
        const negativePrompt = $('#iagf_regen_negative').val().trim();
        const width = parseInt($('#iagf_regen_width').val()) || 832;
        const height = parseInt($('#iagf_regen_height').val()) || 1216;
        const steps = parseInt($('#iagf_regen_steps').val()) || 28;
        const scale = parseFloat($('#iagf_regen_scale').val()) || 5.0;
        let seed = parseInt($('#iagf_regen_seed').val());
        const sampler = $('#iagf_regen_sampler').val() || 'k_euler_ancestral';
        const cfgRescale = parseFloat($('#iagf_regen_cfg_rescale').val()) || 0;
        const variety = $('#iagf_regen_variety').val() === 'true';
        
        if (seed < 0) {
            seed = Math.floor(Math.random() * 2147483647);
        }
        
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
            if (!Array.isArray(message.extra.image_swipes)) {
                message.extra.image_swipes = [];
            }
            if (message.extra.image && !message.extra.image_swipes.includes(message.extra.image)) {
                message.extra.image_swipes.push(message.extra.image);
            }
            
            message.extra.image = result;
            message.extra.title = prompt;
            message.extra.inline_image = true;
            message.extra.image_swipes.push(result);
            
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
            
            // UI 업데이트
            const $mes = $(`.mes[mesid="${currentRegenMesId}"]`);
            appendMediaToMessage(message, $mes);
            
            // 새 이미지로 swipe 이동
            const swipeIndex = message.extra.image_swipes.length - 1;
            navigateToImageSwipe($mes, swipeIndex);
            
            await context.saveChat();
            
            toastr.success('Image regenerated!');
            closeRegenModal();
        }
    } catch (error) {
        console.error(`[${extensionName}] Regeneration error:`, error);
        toastr.error(`Regeneration failed: ${error.message}`);
    } finally {
        $btn.prop('disabled', false).html('<i class="fa-solid fa-rotate"></i> Regenerate');
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
            if (!Array.isArray(message.extra.image_swipes)) {
                message.extra.image_swipes = [];
            }
            if (message.extra.image && !message.extra.image_swipes.includes(message.extra.image)) {
                message.extra.image_swipes.push(message.extra.image);
            }
            
            message.extra.image = result;
            message.extra.image_swipes.push(result);
            message.extra.iagf_gen_params.seed = newSeed;
            
            const $mes = $(`.mes[mesid="${mesId}"]`);
            appendMediaToMessage(message, $mes);
            
            // 새 이미지로 swipe 이동
            const swipeIndex = message.extra.image_swipes.length - 1;
            navigateToImageSwipe($mes, swipeIndex);
            
            await context.saveChat();
            
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
        const charRefImages = charData.images.map(img => stripBase64Header(img));
        requestBody.parameters.director_reference_images = charRefImages;
        requestBody.parameters.director_reference_strength_values = charRefImages.map(() => 1.0);
        requestBody.parameters.director_reference_information_extracted = charRefImages.map(() => 1.0);
        requestBody.parameters.director_reference_secondary_strength_values = charRefImages.map(() => 1.0 - (parseFloat(charData.fidelity) || 0.6));
        const charRefCaption = charData.styleAware ? 'character&style' : 'character';
        requestBody.parameters.director_reference_descriptions = charRefImages.map(() => ({
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
    
    if (!imageData) {
        throw new Error('NAI API returned empty response');
    }
    
    return imageData.startsWith('data:') ? imageData : `data:image/png;base64,${imageData}`;
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
    
    // 이미지가 있는 경우에만 버튼 추가 (image 또는 media 배열 체크)
    const hasImage = message?.extra?.image || 
                     (message?.extra?.media && message.extra.media.length > 0) ||
                     $img.length > 0;
    if (!hasImage) {
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
        openRegenModal(mesId, genParams);
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
        
        // 매칭되는 태그 찾기
        const matches = autocompleteTags
            .filter(tag => {
                const label = (tag.label || tag).toLowerCase();
                return label.includes(currentWord);
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

// 내보내기 (다른 확장에서 사용할 수 있도록)
window.imageAutoGeneration = {
    applyPresetToPrompt,
    getNAIExtraParams,
    detectCharacterFromPrompt,
    regenerateWithNewSeed,
    openRegenModal,
    navigateToImageSwipe,
};

