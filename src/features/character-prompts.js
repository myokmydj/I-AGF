/**
 * IAGF - Character Prompts Module
 * 캐릭터 프롬프트 (v4) 관리
 */

import { generateCharacterPromptId, getCharacterColor } from '../core/utils.js';
import { createNewCharacterPrompt } from '../core/settings.js';

/**
 * Character Prompts 관리 클래스
 */
export class CharacterPromptsManager {
    constructor(settings, saveSettings, getBotName) {
        this.settings = settings;
        this.saveSettings = saveSettings;
        this.getBotName = getBotName;
        this.saveTimer = null;
    }

    get promptSettings() {
        return this.settings.characterPrompts;
    }

    /**
     * 현재 봇의 캐릭터 프롬프트 가져오기
     */
    getCharacterPrompts() {
        const botName = this.getBotName();
        if (!botName || !this.promptSettings?.perBot) {
            return [];
        }
        return this.promptSettings.perBot[botName]?.characters || [];
    }

    /**
     * 현재 봇의 캐릭터 프롬프트 저장
     */
    setCharacterPrompts(characters) {
        const botName = this.getBotName();
        if (!botName) return;

        if (!this.promptSettings.perBot) {
            this.promptSettings.perBot = {};
        }

        this.promptSettings.perBot[botName] = { characters };
        this.saveSettings();
    }

    /**
     * 디바운스된 저장
     */
    saveDebounced(characters) {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.setCharacterPrompts(characters);
            this.saveTimer = null;
        }, 500);
    }

    /**
     * 캐릭터 프롬프트 추가
     */
    addCharacterPrompt() {
        const botName = this.getBotName();
        if (!botName) return null;

        const characters = this.getCharacterPrompts();
        const newChar = createNewCharacterPrompt(generateCharacterPromptId());
        characters.push(newChar);
        this.setCharacterPrompts(characters);
        return newChar;
    }

    /**
     * 캐릭터 프롬프트 삭제
     */
    deleteCharacterPrompt(id) {
        const characters = this.getCharacterPrompts();
        const index = characters.findIndex(c => c.id === id);
        if (index !== -1) {
            characters.splice(index, 1);
            this.setCharacterPrompts(characters);
            return true;
        }
        return false;
    }

    /**
     * 캐릭터 프롬프트 업데이트
     */
    updateCharacterPrompt(id, updates) {
        const characters = this.getCharacterPrompts();
        const char = characters.find(c => c.id === id);
        if (char) {
            Object.assign(char, updates);
            this.saveDebounced(characters);
            return true;
        }
        return false;
    }

    /**
     * 캐릭터 프롬프트 토글
     */
    toggleCharacterPrompt(id) {
        const characters = this.getCharacterPrompts();
        const char = characters.find(c => c.id === id);
        if (char) {
            char.enabled = !char.enabled;
            this.setCharacterPrompts(characters);
            return true;
        }
        return false;
    }

    /**
     * 모든 캐릭터 프롬프트 삭제
     */
    clearAll() {
        this.setCharacterPrompts([]);
    }

    /**
     * NAI 요청용 파라미터 가져오기
     */
    getExtraParams() {
        if (!this.promptSettings?.enabled) return null;

        const charPrompts = this.getCharacterPrompts();
        const enabled = charPrompts.filter(c => c?.enabled && c?.prompt?.trim());

        if (enabled.length === 0) return null;

        return {
            characterPrompts: enabled.map(c => ({
                prompt: c.prompt,
                negative: c.negative || '',
                enabled: true,
                position: c.position || { x: 0.5, y: 0.5 },
            })),
            positionEnabled: this.promptSettings.positionEnabled || false,
        };
    }

    /**
     * 상태 정보 가져오기
     */
    getStatus() {
        if (!this.promptSettings?.enabled) {
            return { text: 'Disabled', active: false };
        }

        const charPrompts = this.getCharacterPrompts();
        const enabled = charPrompts.filter(c => c?.enabled && c?.prompt?.trim());

        if (enabled.length > 0) {
            return { text: `${enabled.length} character(s)`, active: true };
        }

        return { text: 'Not set', active: false };
    }

    /**
     * 캐릭터 색상 가져오기
     */
    getColor(index) {
        return getCharacterColor(index);
    }
}
