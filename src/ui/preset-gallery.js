/**
 * IAGF - Preset Gallery Modal
 * 프리셋 갤러리 UI
 */

import { extensionName } from '../core/constants.js';
import { escapeHtmlAttribute } from '../core/utils.js';

let isGeneratingPreview = false;

// 샘플러 목록
const SAMPLERS = [
    { value: 'k_euler', label: 'Euler' },
    { value: 'k_euler_ancestral', label: 'Euler Ancestral' },
    { value: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
    { value: 'k_dpmpp_2m', label: 'DPM++ 2M' },
    { value: 'k_dpmpp_sde', label: 'DPM++ SDE' },
    { value: 'ddim_v3', label: 'DDIM' },
];

/**
 * 프리셋 갤러리 모달 초기화
 */
export function initPresetGalleryModal() {
    if ($('#iagf_preset_gallery_modal').length) return;

    const samplerOptions = SAMPLERS.map(s => `<option value="${s.value}">${s.label}</option>`).join('');

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

    <!-- Advanced Settings Modal -->
    <div id="iagf_advanced_settings_modal" class="iagf-modal iagf-advanced-modal" style="display:none;">
        <div class="iagf-modal-overlay"></div>
        <div class="iagf-modal-content iagf-advanced-content">
            <div class="iagf-modal-header">
                <h3><i class="fa-solid fa-sliders"></i> <span id="iagf_advanced_preset_name">Advanced Settings</span></h3>
                <button class="iagf-modal-close"><i class="fa-solid fa-times"></i></button>
            </div>
            <div class="iagf-modal-body">
                <div class="iagf-advanced-toggle">
                    <label>
                        <input type="checkbox" id="iagf_advanced_enabled">
                        <span>Enable advanced settings for this preset</span>
                    </label>
                    <small>When disabled, uses global SD settings</small>
                </div>

                <div id="iagf_advanced_fields" class="iagf-advanced-fields">
                    <div class="iagf-advanced-row">
                        <div class="iagf-advanced-field">
                            <label>WIDTH</label>
                            <input type="number" id="iagf_advanced_width" min="64" max="2048" step="64" placeholder="1216">
                        </div>
                        <div class="iagf-advanced-field">
                            <label>HEIGHT</label>
                            <input type="number" id="iagf_advanced_height" min="64" max="2048" step="64" placeholder="832">
                        </div>
                    </div>

                    <div class="iagf-advanced-row">
                        <div class="iagf-advanced-field">
                            <label>STEPS</label>
                            <input type="number" id="iagf_advanced_steps" min="1" max="50" placeholder="28">
                        </div>
                        <div class="iagf-advanced-field">
                            <label>SCALE (CFG)</label>
                            <input type="number" id="iagf_advanced_scale" min="0" max="10" step="0.1" placeholder="5">
                        </div>
                    </div>

                    <div class="iagf-advanced-row">
                        <div class="iagf-advanced-field">
                            <label>SEED (-1 = RANDOM)</label>
                            <input type="number" id="iagf_advanced_seed" min="-1" placeholder="-1">
                        </div>
                        <div class="iagf-advanced-field">
                            <label>SAMPLER</label>
                            <select id="iagf_advanced_sampler">
                                <option value="">Use SD setting</option>
                                ${samplerOptions}
                            </select>
                        </div>
                    </div>

                    <div class="iagf-advanced-row">
                        <div class="iagf-advanced-field">
                            <label>CFG RESCALE</label>
                            <input type="number" id="iagf_advanced_cfg_rescale" min="0" max="1" step="0.05" placeholder="0">
                        </div>
                        <div class="iagf-advanced-field">
                            <label>VARIETY+</label>
                            <select id="iagf_advanced_variety">
                                <option value="">Use SD setting</option>
                                <option value="false">Off</option>
                                <option value="true">On</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div class="iagf-advanced-actions">
                    <button id="iagf_advanced_save" class="iagf-btn-save">
                        <i class="fa-solid fa-check"></i> Save
                    </button>
                    <button id="iagf_advanced_cancel" class="iagf-btn-cancel">
                        <i class="fa-solid fa-times"></i> Cancel
                    </button>
                </div>
            </div>
        </div>
    </div>
    <style>
        .iagf-modal {
            position: fixed;
            inset: 0;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding-top: max(16px, env(safe-area-inset-top));
            padding-right: max(16px, env(safe-area-inset-right));
            padding-bottom: max(16px, env(safe-area-inset-bottom));
            padding-left: max(16px, env(safe-area-inset-left));
            box-sizing: border-box;
        }
        .iagf-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.7);
        }
        .iagf-modal-content {
            position: relative;
            background: var(--SmartThemeBlurTintColor, #1a1a1a);
            border-radius: 10px;
            width: min(800px, 100%);
            max-height: 100%;
            display: flex;
            flex-direction: column;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            overflow: hidden;
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

        @supports (height: 100dvh) {
            .iagf-modal {
                height: 100dvh;
            }
        }

        /* Advanced Settings Modal Styles */
        .iagf-advanced-modal {
            z-index: 10000;
        }
        .iagf-advanced-content {
            width: min(500px, 95%);
            max-height: 90vh;
        }
        .iagf-advanced-toggle {
            margin-bottom: 15px;
            padding: 10px;
            background: var(--SmartThemeBorderColor, #333);
            border-radius: 6px;
        }
        .iagf-advanced-toggle label {
            display: flex;
            align-items: center;
            gap: 10px;
            cursor: pointer;
            color: var(--SmartThemeBodyColor, #fff);
        }
        .iagf-advanced-toggle small {
            display: block;
            margin-top: 5px;
            margin-left: 28px;
            color: var(--SmartThemeBodyColor, #888);
            opacity: 0.7;
        }
        .iagf-advanced-fields {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .iagf-advanced-fields.disabled {
            opacity: 0.4;
            pointer-events: none;
        }
        .iagf-advanced-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
        }
        .iagf-advanced-field {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .iagf-advanced-field label {
            font-size: 0.75em;
            font-weight: bold;
            color: var(--SmartThemeBodyColor, #aaa);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .iagf-advanced-field input,
        .iagf-advanced-field select {
            padding: 8px 10px;
            border: 1px solid var(--SmartThemeBorderColor, #444);
            border-radius: 4px;
            background: var(--SmartThemeBorderColor, #2a2a2a);
            color: var(--SmartThemeBodyColor, #fff);
            font-size: 0.95em;
        }
        .iagf-advanced-field input:focus,
        .iagf-advanced-field select:focus {
            outline: none;
            border-color: var(--SmartThemeQuoteColor, #4a9);
        }
        .iagf-advanced-actions {
            display: flex;
            gap: 10px;
            margin-top: 20px;
            justify-content: flex-end;
        }
        .iagf-advanced-actions button {
            padding: 8px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
            transition: all 0.2s;
        }
        .iagf-btn-save {
            background: var(--SmartThemeQuoteColor, #4a9);
            color: white;
        }
        .iagf-btn-save:hover {
            filter: brightness(1.2);
        }
        .iagf-btn-cancel {
            background: var(--SmartThemeBorderColor, #444);
            color: var(--SmartThemeBodyColor, #fff);
        }
        .iagf-btn-cancel:hover {
            filter: brightness(1.2);
        }
        .iagf-btn-settings {
            background: var(--SmartThemeBorderColor, #555);
            color: var(--SmartThemeBodyColor, #fff);
        }
        .iagf-btn-settings:hover {
            filter: brightness(1.2);
        }
        .iagf-btn-settings.has-settings {
            background: var(--SmartThemeQuoteColor, #4a9);
            color: white;
        }

        /* 반응형 - 태블릿 */
        @media (max-width: 1024px) {
            .iagf-modal-content {
                width: min(700px, 100%);
            }
            .iagf-preset-cards {
                grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
                gap: 12px;
            }
        }

        /* 반응형 - 모바일 */
        @media (max-width: 768px) {
            .iagf-modal {
                padding: 8px;
                padding-top: max(8px, env(safe-area-inset-top));
                padding-right: max(8px, env(safe-area-inset-right));
                padding-bottom: max(8px, env(safe-area-inset-bottom));
                padding-left: max(8px, env(safe-area-inset-left));
            }
            .iagf-modal-content {
                width: 100%;
                max-height: calc(100vh - 16px);
                border-radius: 8px;
            }
            @supports (height: 100dvh) {
                .iagf-modal-content {
                    max-height: calc(100dvh - 16px);
                }
            }
            .iagf-modal-header {
                padding: 12px 16px;
            }
            .iagf-modal-header h3 {
                font-size: 1rem;
            }
            .iagf-modal-close {
                padding: 8px;
                min-width: 44px;
                min-height: 44px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .iagf-modal-body {
                padding: 12px;
            }
            .iagf-preset-cards {
                grid-template-columns: repeat(2, 1fr);
                gap: 10px;
            }
            .iagf-preset-card {
                padding: 8px;
                border-radius: 6px;
            }
            .iagf-preset-card-preview {
                height: 120px;
                margin-bottom: 8px;
            }
            .iagf-preset-card-name {
                font-size: 0.85rem;
                gap: 6px;
            }
            .iagf-preset-card-name input[type="checkbox"] {
                width: 20px;
                height: 20px;
                min-width: 20px;
            }
            .iagf-preset-card-actions {
                gap: 4px;
                margin-top: 8px;
            }
            .iagf-preset-card-actions button {
                padding: 8px 10px;
                font-size: 0.8em;
                min-height: 36px;
            }

            /* Advanced Settings Modal 모바일 */
            .iagf-advanced-content {
                width: 100%;
                max-height: calc(100vh - 16px);
            }
            @supports (height: 100dvh) {
                .iagf-advanced-content {
                    max-height: calc(100dvh - 16px);
                }
            }
            .iagf-advanced-toggle {
                padding: 12px;
            }
            .iagf-advanced-toggle label {
                gap: 12px;
            }
            .iagf-advanced-toggle small {
                margin-left: 32px;
            }
            .iagf-advanced-row {
                grid-template-columns: 1fr;
                gap: 12px;
            }
            .iagf-advanced-field input,
            .iagf-advanced-field select {
                padding: 12px;
                font-size: 1rem;
                min-height: 44px;
            }
            .iagf-advanced-actions {
                flex-direction: column;
                gap: 8px;
            }
            .iagf-advanced-actions button {
                width: 100%;
                padding: 12px 20px;
                min-height: 44px;
                font-size: 1rem;
            }
        }

        /* 반응형 - 소형 모바일 */
        @media (max-width: 480px) {
            .iagf-modal {
                padding: 4px;
            }
            .iagf-modal-content {
                max-height: calc(100vh - 8px);
                border-radius: 6px;
            }
            @supports (height: 100dvh) {
                .iagf-modal-content {
                    max-height: calc(100dvh - 8px);
                }
            }
            .iagf-preset-cards {
                grid-template-columns: 1fr;
                gap: 8px;
            }
            .iagf-preset-card {
                display: flex;
                flex-direction: row;
                padding: 10px;
            }
            .iagf-preset-card-preview {
                width: 80px;
                height: 80px;
                margin-bottom: 0;
                margin-right: 12px;
                flex-shrink: 0;
            }
            .iagf-preset-card-info {
                flex: 1;
                display: flex;
                flex-direction: column;
                justify-content: center;
            }
            .iagf-preset-card-actions {
                margin-top: 8px;
            }
        }
    </style>
    `;
    $('body').append(modalHtml);

    $('#iagf_preset_gallery_modal .iagf-modal-overlay, #iagf_preset_gallery_modal .iagf-modal-close')
        .on('click', closePresetGallery);

    // Advanced settings modal events
    $('#iagf_advanced_settings_modal .iagf-modal-overlay, #iagf_advanced_settings_modal .iagf-modal-close, #iagf_advanced_cancel')
        .on('click', closeAdvancedSettingsModal);

    $('#iagf_advanced_enabled').on('change', function () {
        const enabled = $(this).is(':checked');
        $('#iagf_advanced_fields').toggleClass('disabled', !enabled);
    });
}

/**
 * 프리셋 갤러리 열기
 */
export function openPresetGallery(settings, onSelectPreset, onGeneratePreview, onSaveSettings) {
    renderPresetCards(settings, onSelectPreset, onGeneratePreview, onSaveSettings);
    $('#iagf_preset_gallery_modal').fadeIn(200);
}

/**
 * 프리셋 갤러리 닫기
 */
export function closePresetGallery() {
    $('#iagf_preset_gallery_modal').fadeOut(200);
}

// 현재 편집 중인 프리셋 정보 저장
let currentEditingPreset = null;
let currentSettings = null;
let currentSaveCallback = null;

/**
 * 고급 설정 모달 열기
 */
export function openAdvancedSettingsModal(presetKey, settings, onSave) {
    const preset = settings.presets[presetKey];
    if (!preset) return;

    currentEditingPreset = presetKey;
    currentSettings = settings;
    currentSaveCallback = onSave;

    const advSettings = preset.advancedSettings || {};

    $('#iagf_advanced_preset_name').text(`${preset.name} - Advanced Settings`);
    $('#iagf_advanced_enabled').prop('checked', advSettings.enabled || false);
    $('#iagf_advanced_width').val(advSettings.width || '');
    $('#iagf_advanced_height').val(advSettings.height || '');
    $('#iagf_advanced_steps').val(advSettings.steps || '');
    $('#iagf_advanced_scale').val(advSettings.scale || '');
    $('#iagf_advanced_seed').val(advSettings.seed ?? '');
    $('#iagf_advanced_sampler').val(advSettings.sampler || '');
    $('#iagf_advanced_cfg_rescale').val(advSettings.cfgRescale || '');
    $('#iagf_advanced_variety').val(advSettings.varietyPlus != null ? String(advSettings.varietyPlus) : '');

    $('#iagf_advanced_fields').toggleClass('disabled', !advSettings.enabled);

    // Save 버튼 이벤트
    $('#iagf_advanced_save').off('click').on('click', saveAdvancedSettings);

    $('#iagf_advanced_settings_modal').fadeIn(200);
}

/**
 * 고급 설정 모달 닫기
 */
export function closeAdvancedSettingsModal() {
    $('#iagf_advanced_settings_modal').fadeOut(200);
    currentEditingPreset = null;
    currentSettings = null;
    currentSaveCallback = null;
}

/**
 * 고급 설정 저장
 */
function saveAdvancedSettings() {
    if (!currentEditingPreset || !currentSettings) return;

    const preset = currentSettings.presets[currentEditingPreset];
    if (!preset) return;

    const enabled = $('#iagf_advanced_enabled').is(':checked');

    const parseNumber = (val, isFloat = false) => {
        if (val === '' || val === null || val === undefined) return null;
        const num = isFloat ? parseFloat(val) : parseInt(val, 10);
        return isNaN(num) ? null : num;
    };

    preset.advancedSettings = {
        enabled: enabled,
        width: parseNumber($('#iagf_advanced_width').val()),
        height: parseNumber($('#iagf_advanced_height').val()),
        steps: parseNumber($('#iagf_advanced_steps').val()),
        scale: parseNumber($('#iagf_advanced_scale').val(), true),
        seed: parseNumber($('#iagf_advanced_seed').val()),
        sampler: $('#iagf_advanced_sampler').val() || null,
        cfgRescale: parseNumber($('#iagf_advanced_cfg_rescale').val(), true),
        varietyPlus: $('#iagf_advanced_variety').val() === '' ? null : $('#iagf_advanced_variety').val() === 'true',
    };

    if (currentSaveCallback) {
        currentSaveCallback();
    }

    closeAdvancedSettingsModal();

    // UI 새로고침
    if (typeof toastr !== 'undefined') {
        toastr.success('Advanced settings saved');
    }
}

/**
 * 프리셋 카드 렌더링
 */
export function renderPresetCards(settings, onSelectPreset, onGeneratePreview, onSaveSettings) {
    const container = $('#iagf_preset_cards_container');
    container.empty();

    const presets = settings.presets || {};
    const currentPreset = settings.currentPreset;

    for (const [key, preset] of Object.entries(presets)) {
        const isActive = key === currentPreset;
        const previewImage = preset.previewImage || null;
        const hasAdvancedSettings = preset.advancedSettings?.enabled;

        const cardHtml = `
            <div class="iagf-preset-card ${isActive ? 'active' : ''}" data-preset-key="${key}">
                <div class="iagf-preset-card-preview">
                    ${previewImage
                        ? `<img src="${previewImage}" alt="${escapeHtmlAttribute(preset.name)}">`
                        : '<div class="no-preview"><i class="fa-solid fa-image"></i><br>No preview</div>'
                    }
                </div>
                <div class="iagf-preset-card-info">
                    <div class="iagf-preset-card-name">
                        <input type="checkbox" ${isActive ? 'checked' : ''} data-preset-key="${key}">
                        <span>${escapeHtmlAttribute(preset.name)}</span>
                    </div>
                </div>
                <div class="iagf-preset-card-actions">
                    <button class="iagf-btn-settings ${hasAdvancedSettings ? 'has-settings' : ''}" data-preset-key="${key}" title="Advanced Settings">
                        <i class="fa-solid fa-sliders"></i>
                    </button>
                    <button class="iagf-btn-preview" data-preset-key="${key}" ${isGeneratingPreview ? 'disabled' : ''}>
                        <i class="fa-solid fa-eye"></i> Preview
                    </button>
                </div>
            </div>
        `;
        container.append(cardHtml);
    }

    // 체크박스 이벤트
    container.find('input[type="checkbox"]').on('change', function () {
        const key = $(this).data('preset-key');
        if (onSelectPreset) {
            onSelectPreset(key);
        }
        renderPresetCards(settings, onSelectPreset, onGeneratePreview, onSaveSettings);
    });

    // 고급 설정 버튼 이벤트
    container.find('.iagf-btn-settings').on('click', function () {
        const key = $(this).data('preset-key');
        openAdvancedSettingsModal(key, settings, () => {
            if (onSaveSettings) {
                onSaveSettings();
            }
            renderPresetCards(settings, onSelectPreset, onGeneratePreview, onSaveSettings);
        });
    });

    // 프리뷰 버튼 이벤트
    container.find('.iagf-btn-preview').on('click', async function () {
        if (isGeneratingPreview) return;

        const key = $(this).data('preset-key');
        const $btn = $(this);

        isGeneratingPreview = true;
        $btn.addClass('generating').prop('disabled', true);
        container.find('.iagf-btn-preview').prop('disabled', true);

        try {
            if (onGeneratePreview) {
                await onGeneratePreview(key);
            }
        } finally {
            isGeneratingPreview = false;
            $btn.removeClass('generating');
            container.find('.iagf-btn-preview').prop('disabled', false);
            renderPresetCards(settings, onSelectPreset, onGeneratePreview, onSaveSettings);
        }
    });
}
