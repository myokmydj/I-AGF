/**
 * IAGF - Character Reference Module
 * 캐릭터 레퍼런스 관리 (봇별)
 */

import { generateImageId } from '../core/utils.js';
import { initBotCharacterRefData, createNewCharacterData } from '../core/settings.js';

/**
 * Character Reference 관리 클래스
 */
export class CharacterRefManager {
    constructor(settings, saveSettings, getBotName) {
        this.settings = settings;
        this.saveSettings = saveSettings;
        this.getBotName = getBotName;
    }

    get charRefSettings() {
        return this.settings.characterReference;
    }

    /**
     * 현재 봇의 캐릭터 레퍼런스 데이터 가져오기
     */
    getBotData() {
        const botName = this.getBotName();
        if (!botName || !this.charRefSettings.perBot) {
            return null;
        }
        return this.charRefSettings.perBot[botName] || null;
    }

    /**
     * 현재 봇의 캐릭터 레퍼런스 데이터 설정
     */
    setBotData(data) {
        const botName = this.getBotName();
        if (!botName) return;

        if (!this.charRefSettings.perBot) {
            this.charRefSettings.perBot = {};
        }
        this.charRefSettings.perBot[botName] = data;
        this.saveSettings();
    }

    /**
     * 캐릭터 추가
     */
    addCharacter(charName) {
        const botName = this.getBotName();
        if (!botName || !charName) return false;

        let botData = this.getBotData();
        if (!botData) {
            botData = initBotCharacterRefData();
        }

        if (botData.characters[charName]) {
            return false; // 이미 존재
        }

        botData.characters[charName] = createNewCharacterData(this.settings);
        this.setBotData(botData);
        return true;
    }

    /**
     * 캐릭터 삭제
     */
    deleteCharacter(charName) {
        const botData = this.getBotData();
        if (!botData?.characters?.[charName]) return false;

        delete botData.characters[charName];
        if (botData.activeCharacter === charName) {
            botData.activeCharacter = null;
        }
        this.setBotData(botData);
        return true;
    }

    /**
     * 캐릭터 활성화
     */
    activateCharacter(charName) {
        const botData = this.getBotData();
        if (!botData?.characters?.[charName]) return false;

        botData.activeCharacter = charName;
        this.setBotData(botData);
        return true;
    }

    toggleCharacterEnabled(charName) {
        const botData = this.getBotData();
        if (!botData?.characters?.[charName]) return false;

        botData.characters[charName].enabled = !botData.characters[charName].enabled;
        this.setBotData(botData);
        return botData.characters[charName].enabled;
    }

    toggleImageEnabled(charName, imageId) {
        const botData = this.getBotData();
        if (!botData?.characters?.[charName]) return false;

        const image = botData.characters[charName].images.find(img => img.id === imageId);
        if (!image) return false;

        image.enabled = image.enabled === false ? true : false;
        this.setBotData(botData);
        return image.enabled;
    }

    /**
     * 캐릭터에 이미지 추가
     */
    addImageToCharacter(charName, imageData, imageName) {
        const botData = this.getBotData();
        if (!botData?.characters?.[charName]) return null;

        const id = generateImageId();
        const newImage = { id, data: imageData, name: imageName };

        botData.characters[charName].images.push(newImage);

        // 첫 이미지면 자동 선택
        if (botData.characters[charName].images.length === 1) {
            botData.characters[charName].activeImageId = id;
        }

        this.setBotData(botData);
        return newImage;
    }

    /**
     * 이미지 선택
     */
    selectImage(charName, imageId) {
        const botData = this.getBotData();
        if (!botData?.characters?.[charName]) return;

        botData.characters[charName].activeImageId = imageId;
        this.setBotData(botData);
    }

    /**
     * 이미지 삭제
     */
    deleteImage(charName, imageId) {
        const botData = this.getBotData();
        if (!botData?.characters?.[charName]) return;

        const charData = botData.characters[charName];
        const index = charData.images.findIndex(img => img.id === imageId);
        
        if (index !== -1) {
            charData.images.splice(index, 1);
            if (charData.activeImageId === imageId) {
                charData.activeImageId = null;
            }
            this.setBotData(botData);
        }
    }

    /**
     * Fidelity 설정
     */
    setFidelity(charName, fidelity) {
        const botData = this.getBotData();
        if (!botData?.characters?.[charName]) return;

        botData.characters[charName].fidelity = fidelity;
        this.setBotData(botData);
    }

    /**
     * Style Aware 설정
     */
    setStyleAware(charName, styleAware) {
        const botData = this.getBotData();
        if (!botData?.characters?.[charName]) return;

        botData.characters[charName].styleAware = styleAware;
        this.setBotData(botData);
    }

    /**
     * NAI 요청용 파라미터 가져오기
     */
    getExtraParams() {
        if (!this.charRefSettings.enabled) return null;

        const botData = this.getBotData();
        if (!botData) return null;

        const enabledImages = [];
        let firstCharFidelity = this.charRefSettings.defaultFidelity;
        let firstCharStyleAware = this.charRefSettings.defaultStyleAware;

        for (const [charName, charData] of Object.entries(botData.characters || {})) {
            if (charData.enabled === false) continue;
            
            for (const image of charData.images || []) {
                if (image.enabled === false) continue;
                if (image.data) {
                    enabledImages.push(image.data);
                    if (enabledImages.length === 1) {
                        firstCharFidelity = charData.fidelity ?? this.charRefSettings.defaultFidelity;
                        firstCharStyleAware = charData.styleAware ?? this.charRefSettings.defaultStyleAware;
                    }
                }
            }
        }

        if (enabledImages.length === 0) return null;

        return {
            characterName: botData.activeCharacter || 'character',
            images: enabledImages,
            fidelity: firstCharFidelity,
            styleAware: firstCharStyleAware,
        };
    }

    /**
     * 상태 정보 가져오기
     */
    getStatus() {
        const botData = this.getBotData();
        
        if (!this.charRefSettings.enabled || !botData) {
            return { text: 'Not set', active: false };
        }

        let enabledCharCount = 0;
        let enabledImageCount = 0;

        for (const charData of Object.values(botData.characters || {})) {
            if (charData.enabled === false) continue;
            enabledCharCount++;
            for (const image of charData.images || []) {
                if (image.enabled !== false) {
                    enabledImageCount++;
                }
            }
        }

        if (enabledImageCount > 0) {
            return { 
                text: `${enabledImageCount} image(s)`, 
                active: true, 
                characterName: botData.activeCharacter 
            };
        }

        const charCount = Object.keys(botData.characters || {}).length;
        if (charCount > 0) {
            return { text: `${charCount} character(s) (none active)`, active: false };
        }

        return { text: 'Not set', active: false };
    }
}
