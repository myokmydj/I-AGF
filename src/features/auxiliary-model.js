/**
 * IAGF - Auxiliary Model Module
 * 보조 모델을 통한 이미지 프롬프트 생성
 */

import { extensionName } from '../core/constants.js';

/**
 * Auxiliary Model 관리 클래스
 */
export class AuxiliaryModelManager {
    constructor(settings, saveSettings, context) {
        this.settings = settings;
        this.saveSettings = saveSettings;
        this.context = context;
        this.isGenerating = false;
    }

    get auxSettings() {
        return this.settings.auxiliaryModel;
    }

    /**
     * Connection Manager 프로필 목록 가져오기
     */
    getConnectionProfiles() {
        try {
            const ctx = this.context();
            return ctx.extensionSettings?.connectionManager?.profiles || [];
        } catch (error) {
            console.error(`[${extensionName}] Error getting profiles:`, error);
            return [];
        }
    }

    /**
     * 프로필 선택
     */
    selectProfile(profileId) {
        this.auxSettings.connectionProfileId = profileId;
        this.saveSettings();
    }

    /**
     * 활성화/비활성화
     */
    setEnabled(enabled) {
        this.auxSettings.enabled = enabled;
        this.saveSettings();
    }

    /**
     * 프롬프트 템플릿 설정
     */
    setPromptTemplate(prompt) {
        this.auxSettings.prompt = prompt;
        this.saveSettings();
    }

    /**
     * 프롬프트 빌드 (변수 치환)
     */
    buildPrompt(lastMessage, substituteParams) {
        let description = '';
        let persona = '';

        try {
            description = substituteParams('{{description}}') || '';
            persona = substituteParams('{{persona}}') || '';
        } catch (e) {
            console.warn(`[${extensionName}] Error substituting params:`, e);
        }

        let promptText = this.auxSettings.prompt;
        promptText = promptText.replace(/\{\{description\}\}/g, description);
        promptText = promptText.replace(/\{\{persona\}\}/g, persona);
        promptText = promptText.replace(/\{\{lastMessage\}\}/g, lastMessage);

        return [{ role: 'user', content: promptText }];
    }

    /**
     * Connection Manager를 통해 요청 전송
     */
    async sendRequest(profileId, messages) {
        const ctx = this.context();

        if (!ctx.ConnectionManagerRequestService) {
            throw new Error('Connection Manager not available');
        }

        const profiles = this.getConnectionProfiles();
        const profile = profiles.find(p => p.id === profileId);

        if (!profile) {
            throw new Error(`Profile not found: ${profileId}`);
        }

        if (!profile.api) {
            throw new Error('Profile has no API configured');
        }

        const maxTokens = profile.max_tokens || undefined;

        const response = await ctx.ConnectionManagerRequestService.sendRequest(
            profile.id,
            messages,
            maxTokens,
            {},
            {}
        );

        if (response) {
            if (typeof response === 'string') return response;
            if (response.content) return response.content;
            if (response.message) return response.message;
        }

        return null;
    }

    /**
     * 보조 모델로 이미지 프롬프트 생성
     */
    async generate(lastMessage, substituteParams) {
        if (!this.auxSettings?.enabled) return null;

        const profileId = this.auxSettings.connectionProfileId;
        if (!profileId) {
            console.warn(`[${extensionName}] No profile selected`);
            return null;
        }

        if (this.isGenerating) {
            console.log(`[${extensionName}] Already generating`);
            return null;
        }

        this.isGenerating = true;

        try {
            const messages = this.buildPrompt(lastMessage, substituteParams);
            const response = await this.sendRequest(profileId, messages);
            return response;
        } catch (error) {
            console.error(`[${extensionName}] Auxiliary generation error:`, error);
            throw error;
        } finally {
            this.isGenerating = false;
        }
    }

    /**
     * 응답에서 프롬프트 추출
     */
    extractPrompts(response, regex) {
        let matches;
        if (regex.global) {
            matches = [...response.matchAll(regex)];
        } else {
            const match = response.match(regex);
            matches = match ? [match] : [];
        }

        return matches.map(m => m[1]).filter(p => p?.trim());
    }

    /**
     * 상태 정보 가져오기
     */
    getStatus() {
        if (!this.auxSettings?.enabled) {
            return { text: 'Disabled', active: false };
        }

        const profileId = this.auxSettings.connectionProfileId;
        if (!profileId) {
            return { text: 'No profile', active: false };
        }

        const profiles = this.getConnectionProfiles();
        const profile = profiles.find(p => p.id === profileId);

        return {
            text: profile?.name || profileId,
            active: true,
            profileName: profile?.name,
        };
    }
}
