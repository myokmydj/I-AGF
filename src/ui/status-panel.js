/**
 * IAGF - Status Panel Module
 * 상태 패널 UI 관리
 */

import { extensionName } from '../core/constants.js';
import { truncateString } from '../core/utils.js';

/**
 * 상태 패널 관리 클래스
 */
export class StatusPanelManager {
    constructor(settings, managers) {
        this.settings = settings;
        this.managers = managers;
    }

    /**
     * 상태 패널 업데이트
     */
    update() {
        this.updatePresetStatus();
        this.updateVibeStatus();
        this.updateCharRefStatus();
        this.updateNegativeStatus();
        this.updateCharPromptsStatus();
        this.updateAuxiliaryStatus();
        this.updateIndicator();
    }

    updatePresetStatus() {
        const presetName = this.settings.presets[this.settings.currentPreset]?.name || 'Default';
        $('#status_preset_value').text(presetName);
        
        const isActive = this.settings.currentPreset !== 'default';
        $('#status_preset').toggleClass('active', isActive).toggleClass('inactive', !isActive);
    }

    updateVibeStatus() {
        const status = this.managers.vibeTransfer?.getStatus() || { text: 'Not set', active: false };
        
        $('#status_vibe_value').text(status.text).toggleClass('not-set', !status.active);
        $('#status_vibe')
            .toggleClass('active', status.active)
            .toggleClass('inactive', !status.active);
    }

    updateCharRefStatus() {
        const status = this.managers.characterRef?.getStatus() || { text: 'Not set', active: false };
        
        $('#status_charref_value').text(status.text).toggleClass('not-set', !status.active);
        $('#status_charref')
            .toggleClass('active', status.active)
            .toggleClass('inactive', !status.active);
    }

    updateNegativeStatus() {
        const preset = this.settings.presets[this.settings.currentPreset];
        const hasNegative = preset?.negativePrompt?.trim();
        
        const text = hasNegative ? truncateString(preset.negativePrompt, 20) : 'Not set';
        $('#status_negative_value').text(text).toggleClass('not-set', !hasNegative);
        $('#status_negative')
            .toggleClass('active', !!hasNegative)
            .toggleClass('inactive', !hasNegative);
    }

    updateCharPromptsStatus() {
        const status = this.managers.characterPrompts?.getStatus() || { text: 'Not set', active: false };
        
        $('#status_charprompt_value').text(status.text).toggleClass('not-set', !status.active);
        $('#status_charprompt')
            .toggleClass('active', status.active)
            .toggleClass('inactive', !status.active);
    }

    updateAuxiliaryStatus() {
        const status = this.managers.auxiliaryModel?.getStatus() || { text: 'Disabled', active: false };
        
        $('#status_auxiliary_value').text(status.text).toggleClass('not-set', !status.active);
        $('#status_auxiliary')
            .toggleClass('active', status.active)
            .toggleClass('inactive', !status.active);
    }

    updateIndicator() {
        const vibeStatus = this.managers.vibeTransfer?.getStatus() || {};
        const charRefStatus = this.managers.characterRef?.getStatus() || {};
        const charPromptsStatus = this.managers.characterPrompts?.getStatus() || {};
        const auxStatus = this.managers.auxiliaryModel?.getStatus() || {};

        const anyActive = 
            vibeStatus.active || 
            charRefStatus.active || 
            charPromptsStatus.active || 
            auxStatus.active ||
            this.settings.currentPreset !== 'default';

        $('#nai_status_indicator')
            .toggleClass('active', anyActive)
            .toggleClass('inactive', !anyActive);
    }

    /**
     * 생성 중 상태로 변경
     */
    setGenerating(isGenerating) {
        $('#nai_status_indicator')
            .toggleClass('generating', isGenerating)
            .toggleClass('active inactive', !isGenerating);
    }

    /**
     * 생성 피드백 표시
     */
    showFeedback(extraParams) {
        const statusParts = [];

        if (this.settings.currentPreset !== 'default') {
            const presetName = this.settings.presets[this.settings.currentPreset]?.name;
            statusParts.push(`🎨 Preset: ${presetName}`);
        }

        if (extraParams.vibeTransfer) {
            statusParts.push('🎭 Vibe Transfer');
        }

        if (extraParams.characterReference) {
            statusParts.push(`👤 CharRef: ${extraParams.characterReference.characterName}`);
        }

        if (extraParams.characterPrompts?.length) {
            statusParts.push(`👥 CharPrompts: ${extraParams.characterPrompts.length}`);
        }

        if (extraParams.negativePrompt) {
            statusParts.push('🚫 Negative applied');
        }

        if (statusParts.length > 0) {
            console.log(`[${extensionName}] Generation:`, statusParts.join(', '));
        }
    }
}
