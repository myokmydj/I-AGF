/**
 * IAGF - Presets Module
 * 이미지 생성 프리셋 관리
 */

import { extensionName } from '../core/constants.js';
import { escapeHtmlAttribute } from '../core/utils.js';

/**
 * 프리셋 관리 클래스
 */
export class PresetsManager {
    constructor(settings, saveSettings, getRequestHeaders) {
        this.settings = settings;
        this.saveSettings = saveSettings;
        this.getRequestHeaders = getRequestHeaders;
    }

    /**
     * 현재 프리셋 가져오기
     */
    getCurrentPreset() {
        return this.settings.presets[this.settings.currentPreset];
    }

    /**
     * 프리셋 선택
     */
    selectPreset(presetKey) {
        if (this.settings.presets[presetKey]) {
            this.settings.currentPreset = presetKey;
            this.saveSettings();
            return true;
        }
        return false;
    }

    /**
     * 프리셋 추가
     */
    addPreset(name) {
        const key = 'preset_' + Date.now();
        this.settings.presets[key] = {
            name: name || 'New Preset',
            prefixPrompt: '',
            suffixPrompt: '',
            negativePrompt: '',
            previewImage: null,
            advancedSettings: {
                enabled: false,
                width: null,
                height: null,
                steps: null,
                scale: null,
                seed: null,
                sampler: null,
                cfgRescale: null,
                varietyPlus: null,
            },
        };
        this.settings.currentPreset = key;
        this.saveSettings();
        return key;
    }

    /**
     * 현재 프리셋의 고급 설정 가져오기
     */
    getAdvancedSettings() {
        const preset = this.getCurrentPreset();
        if (!preset?.advancedSettings?.enabled) return null;
        return preset.advancedSettings;
    }

    /**
     * 프리셋 고급 설정 업데이트
     */
    updateAdvancedSettings(presetKey, advancedSettings) {
        if (!this.settings.presets[presetKey]) return false;

        this.settings.presets[presetKey].advancedSettings = {
            ...this.settings.presets[presetKey].advancedSettings,
            ...advancedSettings,
        };
        this.saveSettings();
        return true;
    }

    /**
     * 프리셋 삭제
     */
    deletePreset(presetKey) {
        if (presetKey === 'default') return false;
        if (!this.settings.presets[presetKey]) return false;

        delete this.settings.presets[presetKey];
        if (this.settings.currentPreset === presetKey) {
            this.settings.currentPreset = 'default';
        }
        this.saveSettings();
        return true;
    }

    /**
     * 프리셋 업데이트
     */
    updatePreset(presetKey, updates) {
        if (!this.settings.presets[presetKey]) return false;

        Object.assign(this.settings.presets[presetKey], updates);
        this.saveSettings();
        return true;
    }

    /**
     * 프롬프트에 프리셋 적용
     */
    applyToPrompt(prompt) {
        const preset = this.getCurrentPreset();
        if (!preset) return prompt;

        let result = prompt;

        if (preset.prefixPrompt?.trim()) {
            result = preset.prefixPrompt.trim() + ', ' + result;
        }

        if (preset.suffixPrompt?.trim()) {
            result = result + ', ' + preset.suffixPrompt.trim();
        }

        return result;
    }

    /**
     * 프리셋 목록 가져오기
     */
    getPresetList() {
        return Object.entries(this.settings.presets).map(([key, preset]) => ({
            key,
            name: preset.name,
            isActive: this.settings.currentPreset === key,
            hasPreview: !!preset.previewImage,
        }));
    }
}

/**
 * 프리셋 갤러리 모달 HTML 생성
 */
export function createPresetGalleryModal() {
    return `
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
    </div>`;
}

/**
 * 프리셋 카드 HTML 생성
 */
export function renderPresetCard(key, preset, isActive) {
    const previewImage = preset.previewImage || null;
    
    return `
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
                    <i class="fa-solid fa-wand-magic-sparkles"></i> Preview
                </button>
            </div>
        </div>
    `;
}
