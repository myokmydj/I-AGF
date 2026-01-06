/**
 * IAGF - Vibe Transfer Module
 * Vibe Transfer 기능 관리
 */

import { generateImageId, stripBase64Header } from '../core/utils.js';

/**
 * Vibe Transfer 관리 클래스
 */
export class VibeTransferManager {
    constructor(settings, saveSettings) {
        this.settings = settings;
        this.saveSettings = saveSettings;
    }

    get vibeSettings() {
        return this.settings.vibeTransfer;
    }

    /**
     * Vibe Transfer 활성화/비활성화
     */
    setEnabled(enabled) {
        this.vibeSettings.enabled = enabled;
        this.saveSettings();
    }

    /**
     * 이미지 추가
     */
    addImage(base64Data, name) {
        const id = generateImageId();
        this.vibeSettings.images[id] = {
            id,
            data: base64Data,
            name: name || `Vibe ${Object.keys(this.vibeSettings.images).length + 1}`,
            active: true,
        };
        
        if (!this.vibeSettings.selectedImageId) {
            this.vibeSettings.selectedImageId = id;
        }
        
        this.saveSettings();
        return id;
    }

    /**
     * 이미지 삭제
     */
    deleteImage(id) {
        delete this.vibeSettings.images[id];
        if (this.vibeSettings.selectedImageId === id) {
            const remaining = Object.keys(this.vibeSettings.images);
            this.vibeSettings.selectedImageId = remaining[0] || null;
        }
        this.saveSettings();
    }

    /**
     * 이미지 선택
     */
    selectImage(id) {
        if (this.vibeSettings.images[id]) {
            this.vibeSettings.selectedImageId = id;
            this.saveSettings();
        }
    }

    /**
     * 이미지 활성화/비활성화 토글
     */
    toggleImageActive(id) {
        const image = this.vibeSettings.images[id];
        if (image) {
            image.active = !image.active;
            this.saveSettings();
        }
    }

    /**
     * 강도 설정
     */
    setStrength(strength) {
        this.vibeSettings.defaultStrength = Math.max(0, Math.min(1, strength));
        this.saveSettings();
    }

    /**
     * Info Extracted 설정
     */
    setInfoExtracted(value) {
        this.vibeSettings.defaultInfoExtracted = Math.max(0, Math.min(1, value));
        this.saveSettings();
    }

    /**
     * NAI 요청용 파라미터 가져오기
     */
    getExtraParams() {
        if (!this.vibeSettings.enabled || !this.vibeSettings.selectedImageId) {
            return null;
        }

        const image = this.vibeSettings.images[this.vibeSettings.selectedImageId];
        if (!image || image.active === false) {
            return null;
        }

        return {
            image: image.data,
            strength: this.vibeSettings.defaultStrength,
            infoExtracted: this.vibeSettings.defaultInfoExtracted,
        };
    }

    /**
     * 상태 정보 가져오기
     */
    getStatus() {
        const selected = this.vibeSettings.selectedImageId;
        if (!selected) {
            return { text: 'Not set', active: false };
        }

        const image = this.vibeSettings.images[selected];
        if (!image) {
            return { text: 'Not set', active: false };
        }

        const isActive = image.active !== false && this.vibeSettings.enabled;
        return {
            text: isActive ? '1 image' : '1 image (OFF)',
            active: isActive,
            imageName: image.name,
        };
    }

    /**
     * 이미지 목록 가져오기
     */
    getImageList() {
        return Object.entries(this.vibeSettings.images).map(([id, image]) => ({
            id,
            name: image.name,
            data: image.data,
            active: image.active !== false,
            selected: this.vibeSettings.selectedImageId === id,
        }));
    }
}
