/**
 * IAGF - Settings Module
 * 설정 관리 및 기본값 정의
 */

import { INSERT_TYPE, INJECTION_POSITION } from './constants.js';
import { deepMerge, deepClone } from './utils.js';

/**
 * 기본 설정값
 */
export const defaultSettings = {
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
        position: INJECTION_POSITION.DEEP_SYSTEM,
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
        messageMaxLength: 0,
    },
    
    auxiliaryModel: {
        enabled: false,
        connectionProfileId: '',
        prompt: `You are an AI assistant that generates image prompts for Stable Diffusion/NovelAI. 
Based on the given scene/message, generate appropriate Danbooru-style tags for image generation.

[Character Reference]
{{description}}

[User Persona]
{{persona}}

[Current Scene]
{{lastMessage}}

[Instructions]
1. Analyze the scene and identify key visual elements
2. Generate comma-separated Danbooru tags
3. Include: composition, character details, pose, expression, clothing, background
4. Use proper tag syntax (underscores for multi-word tags)
5. Order: composition → character → details → background → style

OUTPUT FORMAT:
<pic prompt="your_tags_here">

Output ONLY the <pic> tag with your generated prompt inside. No explanations.`,
    },
};

/**
 * 설정 관리 클래스
 */
export class SettingsManager {
    constructor(extensionName, extensionSettings, saveSettingsDebounced) {
        this.extensionName = extensionName;
        this.extensionSettings = extensionSettings;
        this.saveSettingsDebounced = saveSettingsDebounced;
    }

    /**
     * 설정 초기화 (기본값과 병합)
     */
    initialize() {
        if (!this.extensionSettings[this.extensionName]) {
            this.extensionSettings[this.extensionName] = deepClone(defaultSettings);
        } else {
            // 기존 설정과 기본값 병합 (누락된 필드 추가)
            this.extensionSettings[this.extensionName] = deepMerge(
                deepClone(defaultSettings),
                this.extensionSettings[this.extensionName]
            );
        }
        return this.getSettings();
    }

    /**
     * 현재 설정 가져오기
     * @returns {Object} 현재 설정
     */
    getSettings() {
        return this.extensionSettings[this.extensionName];
    }

    /**
     * 설정 업데이트
     * @param {string} path - 설정 경로 (점 표기법)
     * @param {*} value - 새 값
     */
    updateSetting(path, value) {
        const keys = path.split('.');
        let current = this.extensionSettings[this.extensionName];
        
        for (let i = 0; i < keys.length - 1; i++) {
            if (!(keys[i] in current)) {
                current[keys[i]] = {};
            }
            current = current[keys[i]];
        }
        
        current[keys[keys.length - 1]] = value;
        this.saveSettingsDebounced();
    }

    /**
     * 설정 리셋
     */
    reset() {
        this.extensionSettings[this.extensionName] = deepClone(defaultSettings);
        this.saveSettingsDebounced();
    }

    /**
     * 설정 내보내기
     * @returns {string} JSON 문자열
     */
    export() {
        return JSON.stringify(this.getSettings(), null, 2);
    }

    /**
     * 설정 가져오기
     * @param {string} jsonString - JSON 문자열
     * @returns {boolean} 성공 여부
     */
    import(jsonString) {
        try {
            const imported = JSON.parse(jsonString);
            this.extensionSettings[this.extensionName] = deepMerge(
                deepClone(defaultSettings),
                imported
            );
            this.saveSettingsDebounced();
            return true;
        } catch (e) {
            console.error('Failed to import settings:', e);
            return false;
        }
    }
}

/**
 * 봇별 캐릭터 레퍼런스 데이터 초기화
 * @returns {Object} 초기 데이터 구조
 */
export function initBotCharacterRefData() {
    return {
        characters: {},
        activeCharacter: null,
    };
}

/**
 * 새 캐릭터 데이터 생성
 * @param {Object} settings - 현재 설정
 * @returns {Object} 캐릭터 데이터
 */
export function createNewCharacterData(settings) {
    return {
        images: [],
        activeImageId: null,
        enabled: true,
        fidelity: settings.characterReference?.defaultFidelity ?? 0.6,
        styleAware: settings.characterReference?.defaultStyleAware ?? false,
    };
}

/**
 * 새 캐릭터 프롬프트 생성
 * @param {string} id - 고유 ID
 * @returns {Object} 캐릭터 프롬프트 데이터
 */
export function createNewCharacterPrompt(id) {
    return {
        id: id,
        name: '',
        prompt: '',
        negative: '',
        enabled: true,
        position: { x: 0.5, y: 0.5 },
    };
}
