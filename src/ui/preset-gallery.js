/**
 * IAGF - Preset Gallery Modal
 * 프리셋 갤러리 UI
 */

import { extensionName } from '../core/constants.js';
import { escapeHtmlAttribute } from '../core/utils.js';

let isGeneratingPreview = false;

/**
 * 프리셋 갤러리 모달 초기화
 */
export function initPresetGalleryModal() {
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
    </style>
    `;
    $('body').append(modalHtml);
    
    $('#iagf_preset_gallery_modal .iagf-modal-overlay, #iagf_preset_gallery_modal .iagf-modal-close')
        .on('click', closePresetGallery);
}

/**
 * 프리셋 갤러리 열기
 */
export function openPresetGallery(settings, onSelectPreset, onGeneratePreview) {
    renderPresetCards(settings, onSelectPreset, onGeneratePreview);
    $('#iagf_preset_gallery_modal').fadeIn(200);
}

/**
 * 프리셋 갤러리 닫기
 */
export function closePresetGallery() {
    $('#iagf_preset_gallery_modal').fadeOut(200);
}

/**
 * 프리셋 카드 렌더링
 */
export function renderPresetCards(settings, onSelectPreset, onGeneratePreview) {
    const container = $('#iagf_preset_cards_container');
    container.empty();
    
    const presets = settings.presets || {};
    const currentPreset = settings.currentPreset;
    
    for (const [key, preset] of Object.entries(presets)) {
        const isActive = key === currentPreset;
        const previewImage = preset.previewImage || null;
        
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
                    <button class="iagf-btn-preview" data-preset-key="${key}" ${isGeneratingPreview ? 'disabled' : ''}>
                        <i class="fa-solid fa-eye"></i> Preview
                    </button>
                </div>
            </div>
        `;
        container.append(cardHtml);
    }
    
    // 체크박스 이벤트
    container.find('input[type="checkbox"]').on('change', function() {
        const key = $(this).data('preset-key');
        if (onSelectPreset) {
            onSelectPreset(key);
        }
        renderPresetCards(settings, onSelectPreset, onGeneratePreview);
    });
    
    // 프리뷰 버튼 이벤트
    container.find('.iagf-btn-preview').on('click', async function() {
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
            renderPresetCards(settings, onSelectPreset, onGeneratePreview);
        }
    });
}
