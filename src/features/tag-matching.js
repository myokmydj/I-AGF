/**
 * IAGF - Tag Matching Module
 * Danbooru 태그 매칭 기능
 */

import { extensionFolderPath } from '../core/constants.js';

/**
 * Tag Matching 관리 클래스
 */
export class TagMatchingManager {
    constructor(settings, saveSettings) {
        this.settings = settings;
        this.saveSettings = saveSettings;
        this.TagMatcher = null;
        this.isReady = false;
        this.initPromise = null;
    }

    get tagSettings() {
        return this.settings.tagMatching;
    }

    /**
     * 태그 매처 초기화
     */
    async initialize() {
        if (!this.tagSettings?.enabled) {
            console.log('[IAGF] Tag matching disabled');
            return false;
        }

        if (this.isReady) return true;
        if (this.initPromise) return this.initPromise;

        this.initPromise = this._doInitialize();
        return this.initPromise;
    }

    async _doInitialize() {
        try {
            // 동적으로 tag-matcher.js 로드
            if (!this.TagMatcher && !window.TagMatcher) {
                const script = document.createElement('script');
                script.src = `${extensionFolderPath}/tag-matcher.js?v=${Date.now()}`;

                await new Promise((resolve, reject) => {
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            }

            this.TagMatcher = window.TagMatcher;

            if (this.TagMatcher && !this.TagMatcher.isReady()) {
                const tagsUrl = `${extensionFolderPath}/tags.json`;
                await this.TagMatcher.initialize(tagsUrl);
            }

            this.isReady = this.TagMatcher?.isReady() || false;
            return this.isReady;
        } catch (error) {
            console.error('[IAGF] Tag matcher init failed:', error);
            this.isReady = false;
            this.initPromise = null;
            return false;
        }
    }

    /**
     * 프롬프트에 태그 매칭 적용
     */
    processPrompt(prompt) {
        if (!this.tagSettings?.enabled || !this.isReady || !this.TagMatcher) {
            return { prompt, matched: false };
        }

        try {
            const result = this.TagMatcher.processPrompt(prompt, {
                useFuzzyBest: this.tagSettings.useFuzzyBest,
                keepUnmatched: this.tagSettings.keepUnmatched,
            });

            if (this.tagSettings.showStats && result.stats) {
                console.log('[IAGF] Tag matching stats:', result.stats);
            }

            return {
                prompt: result.prompt,
                matched: true,
                original: result.original,
                stats: result.stats,
                results: result.results,
            };
        } catch (error) {
            console.error('[IAGF] Tag matching error:', error);
            return { prompt, matched: false, error };
        }
    }

    /**
     * 설정 업데이트
     */
    async setEnabled(enabled) {
        this.tagSettings.enabled = enabled;
        this.saveSettings();

        if (enabled && !this.isReady) {
            await this.initialize();
        }
    }

    setUseFuzzyBest(value) {
        this.tagSettings.useFuzzyBest = value;
        this.saveSettings();
    }

    setKeepUnmatched(value) {
        this.tagSettings.keepUnmatched = value;
        this.saveSettings();
    }

    setShowStats(value) {
        this.tagSettings.showStats = value;
        this.saveSettings();
    }

    /**
     * 상태 정보 가져오기
     */
    getStatus() {
        if (!this.tagSettings?.enabled) {
            return { text: 'Disabled', ready: false };
        }

        if (this.isReady) {
            return { text: 'Ready ✓', ready: true };
        }

        if (this.initPromise) {
            return { text: 'Loading...', ready: false };
        }

        return { text: 'Not initialized', ready: false };
    }
}
