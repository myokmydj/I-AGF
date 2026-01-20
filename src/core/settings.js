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
    lastSeenVersion: null,
    
    promptInjection: {
        enabled: true,
        prompt: `<image_generation>
At the end of your reply, insert exactly one <pic> tag for Stable Diffusion/NAI image generation.

[Character Reference]
{{description}}

[User Persona]
{{persona}}

[CRITICAL: Tag Format]
- ALL tags MUST be separated by commas
- Each individual concept = one tag = separated by comma
- Example: "from above, cowboy shot, 1girl, solo, bedroom, night"
- NOT: "from above cowboy shot 1girl solo bedroom night"

[Image Tag Components]
All tags MUST depict a single, static visual instant—a snapshot in time.
Use widely recognized Danbooru-style tags, comma-separated.

## Camera Tags (Perspective & Framing)
Perspective (pick one, add "pov" if first-person view):
- from above, from behind, from below, from side, straight-on, sideways

Framing (pick one based on visibility):
- portrait, upper body, cowboy shot, full body, wide shot, lower body, head out of frame

## Scene Tags
Format: [character count], [location], [lighting] - ALL comma-separated
- Character count: 1girl, solo / 2girls / 1boy, 1girl, etc.
- Location: interior/exterior, then specific: bedroom, forest, classroom...
- Lighting: daylight, sunset, night, dim lighting, backlighting, sidelighting...

## Character Tags (for EACH character, separate multiple characters with |)
Order: gender/age → appearance → attire → expression → action → exposed parts
ALL tags within each category MUST be comma-separated.

1. Gender/Age: girl/boy, age tag (e.g., "girl, adolescent" or "boy, male")
2. Appearance:
   - Hair: "long hair, black hair, straight hair, bangs" (each trait = separate tag)
   - Eyes: "blue eyes, tsurime" (color + optional style, comma-separated)
   - Body: "slim, medium breasts" (build + size if applicable)
   - Features: "freckles, dark skin, facial hair"
3. Attire (only visible items):
   - Each item separate: "white shirt, black skirt, red ribbon, boots"
   - Use "naked" if nude, "topless"/"bottomless" for partial
4. Expression: "blush, grin" or "embarrassed, looking away"
5. Action & Gaze:
   - Pose: "standing, arms crossed" or "sitting, leaning forward"
   - Gaze: "looking at viewer" or "looking at another, closed eyes"
   - CHARACTER INTERACTIONS (for multi-character):
     * mutual# tags: "mutual#kissing" or "mutual#holding hands"
     * source# tags: "source#hugging, source#headpat"
     * target# tags: "target#hugging, target#headpat"
6. Exposed parts: "armpits, navel, thighs, cleavage"

[Multi-Character Format]
When 2+ characters: separate each character's tags with | (pipe)
Within each character block, ALL tags must be comma-separated.
Example: "girl, adolescent, long hair, pink hair, red eyes, sitting, blush, target#hugging | girl, female, short hair, blue hair, standing, smile, source#hugging"

[Core Principles]
1. COMMA SEPARATION: Every single tag must be comma-separated
2. CONFLICT PREVENTION: Never combine conflicting tags
3. NO UNDERSCORES: Use spaces within tags, commas between tags
4. NO COPYRIGHT: Don't guess character origins
5. VISUAL ONLY: Tags must be visually representable

[Output Format]
<pic camera="[camera], [framing]" scene="[count], [location], [lighting]" prompt="[char1 tags, comma-separated] | [char2 tags, comma-separated]">

Output ONLY the <pic> tag. No explanations.
</image_generation>`,
        regex: '/<pic\\s+(?:camera="([^"]*)"\\s+)?(?:scene="([^"]*)"\\s+)?prompt="([^"]*)"[^>]*>/g',
        position: INJECTION_POSITION.DEEP_SYSTEM,
        depth: 0,
    },
    
    presets: {
        default: {
            name: 'Default',
            prefixPrompt: '',
            suffixPrompt: '',
            negativePrompt: '',
            // 고급 설정 (null = SD 설정 사용)
            advancedSettings: {
                enabled: false,
                model: null,
                width: null,
                height: null,
                steps: null,
                scale: null,
                seed: null,
                sampler: null,
                cfgRescale: null,
                varietyPlus: null,
                qualityToggle: null,
                ucPreset: null,
            },
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
        prompt: `You are a Danbooru tag generator for Stable Diffusion/NAI. Convert the scene into a structured image prompt.

[Character Reference]
{{description}}

[User Persona]
{{persona}}

[Scene to Convert]
{{message}}

[CRITICAL: Tag Format]
- ALL tags MUST be separated by commas
- Each individual concept = one tag = separated by comma
- Example: "from above, cowboy shot, 1girl, solo, bedroom, night"
- NOT: "from above cowboy shot 1girl solo bedroom night"

[Image Tag Components]
All tags MUST depict a single, static visual instant—a snapshot in time.
Use widely recognized Danbooru-style tags, comma-separated.

## Camera Tags (Perspective & Framing)
Perspective (pick one, add "pov" if first-person view):
- from above, from behind, from below, from side, straight-on, sideways

Framing (pick one based on visibility):
- portrait, upper body, cowboy shot, full body, wide shot, lower body, head out of frame

## Scene Tags
Format: [character count], [location], [lighting] - ALL comma-separated
- Character count: 1girl, solo / 2girls / 1boy, 1girl, etc.
- Location: interior/exterior, then specific: bedroom, forest, classroom...
- Lighting: daylight, sunset, night, dim lighting, backlighting, sidelighting...

## Character Tags (for EACH character, separate multiple characters with |)
Order: gender/age → appearance → attire → expression → action → exposed parts
ALL tags within each category MUST be comma-separated.

1. Gender/Age: girl/boy, age tag (e.g., "girl, adolescent" or "boy, male")
2. Appearance:
   - Hair: "long hair, black hair, straight hair, bangs" (each trait = separate tag)
   - Eyes: "blue eyes, tsurime" (color + optional style, comma-separated)
   - Body: "slim, medium breasts" (build + size if applicable)
   - Features: "freckles, dark skin, facial hair"
3. Attire (only visible items):
   - Each item separate: "white shirt, black skirt, red ribbon, boots"
   - Use "naked" if nude, "topless"/"bottomless" for partial
4. Expression: "blush, grin" or "embarrassed, looking away"
5. Action & Gaze:
   - Pose: "standing, arms crossed" or "sitting, leaning forward"
   - Gaze: "looking at viewer" or "looking at another, closed eyes"
   - CHARACTER INTERACTIONS (for multi-character):
     * mutual# tags: "mutual#kissing" or "mutual#holding hands"
     * source# tags: "source#hugging, source#headpat"
     * target# tags: "target#hugging, target#headpat"
6. Exposed parts: "armpits, navel, thighs, cleavage"

[Multi-Character Format]
When 2+ characters: separate each character's tags with | (pipe)
Within each character block, ALL tags must be comma-separated.
Example: "girl, adolescent, long hair, pink hair, red eyes, sitting, blush, target#hugging | girl, female, short hair, blue hair, standing, smile, source#hugging"

[Core Principles]
1. COMMA SEPARATION: Every single tag must be comma-separated
2. CONFLICT PREVENTION: Never combine conflicting tags
3. NO UNDERSCORES: Use spaces within tags, commas between tags
4. NO COPYRIGHT: Don't guess character origins
5. VISUAL ONLY: Tags must be visually representable

[Output Format - 3 lines]
camera: [perspective], [framing]
scene: [count], [location], [lighting]
prompt: [char1 tags, all comma-separated] | [char2 tags, all comma-separated]

Output ONLY these 3 lines. NO explanations, NO markdown.`,
        maxResponseLength: 500,
        messageMaxLength: 0,
    },
    
    auxiliaryModel: {
        enabled: false,
        connectionProfileId: '',
        prompt: `You are an AI that generates structured image prompts for Stable Diffusion/NovelAI.

[Character Reference]
{{description}}

[User Persona]
{{persona}}

[Current Scene]
{{lastMessage}}

[CRITICAL: Tag Format]
- ALL tags MUST be separated by commas
- Each individual concept = one tag = separated by comma
- Example: "from above, cowboy shot, 1girl, solo, bedroom, night"
- NOT: "from above cowboy shot 1girl solo bedroom night"

[Image Tag Components]
All tags MUST depict a single, static visual instant—a snapshot in time.
Use widely recognized Danbooru-style tags, comma-separated.

## Camera Tags (Perspective & Framing)
Perspective (pick one, add "pov" if first-person view):
- from above, from behind, from below, from side, straight-on, sideways

Framing (pick one based on visibility):
- portrait, upper body, cowboy shot, full body, wide shot, lower body, head out of frame

## Scene Tags
Format: [character count], [location], [lighting] - ALL comma-separated
- Character count: 1girl, solo / 2girls / 1boy, 1girl, etc.
- Location: interior/exterior, then specific: bedroom, forest, classroom...
- Lighting: daylight, sunset, night, dim lighting, backlighting, sidelighting...

## Character Tags (for EACH character, separate multiple characters with |)
Order: gender/age → appearance → attire → expression → action → exposed parts
ALL tags within each category MUST be comma-separated.

1. Gender/Age: girl/boy, age tag (e.g., "girl, adolescent" or "boy, male")
2. Appearance:
   - Hair: "long hair, black hair, straight hair, bangs" (each trait = separate tag)
   - Eyes: "blue eyes, tsurime" (color + optional style, comma-separated)
   - Body: "slim, medium breasts" (build + size if applicable)
   - Features: "freckles, dark skin, facial hair"
3. Attire (only visible items):
   - Each item separate: "white shirt, black skirt, red ribbon, boots"
   - Use "naked" if nude, "topless"/"bottomless" for partial
4. Expression: "blush, grin" or "embarrassed, looking away"
5. Action & Gaze:
   - Pose: "standing, arms crossed" or "sitting, leaning forward"
   - Gaze: "looking at viewer" or "looking at another, closed eyes"
   - CHARACTER INTERACTIONS (for multi-character):
     * mutual# tags: "mutual#kissing" or "mutual#holding hands"
     * source# tags: "source#hugging, source#headpat"
     * target# tags: "target#hugging, target#headpat"
6. Exposed parts: "armpits, navel, thighs, cleavage"

[Multi-Character Format]
When 2+ characters: separate each character's tags with | (pipe)
Within each character block, ALL tags must be comma-separated.
Example: "girl, adolescent, long hair, pink hair, red eyes, sitting, blush, target#hugging | girl, female, short hair, blue hair, standing, smile, source#hugging"

[Core Principles]
1. COMMA SEPARATION: Every single tag must be comma-separated
2. CONFLICT PREVENTION: Never combine conflicting tags
3. NO UNDERSCORES: Use spaces within tags, commas between tags
4. NO COPYRIGHT: Don't guess character origins
5. VISUAL ONLY: Tags must be visually representable

[Output Format]
<pic camera="[camera], [framing]" scene="[count], [location], [lighting]" prompt="[char1 tags, comma-separated] | [char2 tags, comma-separated]">

Output ONLY the <pic> tag. No explanations.`,
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
            this.saveSettingsDebounced();
        } else {
            // 기존 설정과 기본값 병합 (누락된 필드 추가)
            this.extensionSettings[this.extensionName] = deepMerge(
                deepClone(defaultSettings),
                this.extensionSettings[this.extensionName]
            );
            this.saveSettingsDebounced();
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
