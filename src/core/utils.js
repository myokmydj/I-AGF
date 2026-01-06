/**
 * IAGF - Utilities Module
 * 공통 유틸리티 함수들
 */

/**
 * HTML 속성 값 이스케이프
 * @param {string} value - 이스케이프할 문자열
 * @returns {string} 이스케이프된 문자열
 */
export function escapeHtmlAttribute(value) {
    if (typeof value !== 'string') {
        return '';
    }

    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * 고유 이미지 ID 생성
 * @returns {string} 고유 ID
 */
export function generateImageId() {
    return 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * 고유 캐릭터 프롬프트 ID 생성
 * @returns {string} 고유 ID
 */
export function generateCharacterPromptId() {
    return 'char_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * 파일을 Base64로 변환
 * @param {File} file - 변환할 파일
 * @returns {Promise<string>} Base64 데이터 URL
 */
export function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = (error) => reject(error);
    });
}

/**
 * 이미지 비율에 따른 참조 해상도 선택
 * @param {number} width - 원본 너비
 * @param {number} height - 원본 높이
 * @returns {{canvasWidth: number, canvasHeight: number}} 캔버스 크기
 */
export function chooseReferenceResolution(width, height) {
    const ratio = width / height;
    if (ratio >= 0.9 && ratio <= 1.1) {
        return { canvasWidth: 1472, canvasHeight: 1472 };
    } else if (ratio < 1) {
        return { canvasWidth: 1024, canvasHeight: 1536 };
    } else {
        return { canvasWidth: 1536, canvasHeight: 1024 };
    }
}

/**
 * 이미지를 참조용으로 리사이즈
 * @param {string} base64Data - Base64 이미지 데이터
 * @returns {Promise<string>} 리사이즈된 Base64 이미지
 */
export async function resizeImageForReference(base64Data, outputFormat = 'image/png') {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const { canvasWidth, canvasHeight } = chooseReferenceResolution(img.width, img.height);
            
            const canvas = document.createElement('canvas');
            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
            
            const ctx = canvas.getContext('2d');
            
            const scale = Math.min(canvasWidth / img.width, canvasHeight / img.height);
            const w = Math.floor(scale * img.width);
            const h = Math.floor(scale * img.height);
            const x = Math.floor((canvasWidth - w) / 2);
            const y = Math.floor((canvasHeight - h) / 2);
            
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            ctx.drawImage(img, x, y, w, h);
            
            const quality = outputFormat === 'image/jpeg' ? 0.95 : undefined;
            const resizedBase64 = canvas.toDataURL(outputFormat, quality);
            resolve(resizedBase64);
        };
        img.onerror = reject;
        img.src = base64Data.startsWith('data:') ? base64Data : `data:image/png;base64,${base64Data}`;
    });
}

/**
 * Base64 데이터에서 헤더 제거
 * @param {string} base64Data - Base64 데이터
 * @returns {string} 순수 Base64 문자열
 */
export function stripBase64Header(base64Data) {
    if (base64Data.includes(',')) {
        return base64Data.split(',')[1];
    }
    return base64Data;
}

/**
 * 캐릭터 색상 가져오기
 * @param {number} index - 캐릭터 인덱스
 * @returns {string} 색상 코드
 */
export function getCharacterColor(index) {
    const colors = [
        '#22c55e', '#ef4444', '#3b82f6',
        '#f59e0b', '#a855f7', '#06b6d4',
    ];
    return colors[index % colors.length];
}

/**
 * 디바운스 함수
 * @param {Function} func - 실행할 함수
 * @param {number} wait - 대기 시간 (ms)
 * @returns {Function} 디바운스된 함수
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * 딥 클론 (JSON 방식)
 * @param {Object} obj - 복제할 객체
 * @returns {Object} 복제된 객체
 */
export function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * 객체 깊은 병합
 * @param {Object} target - 대상 객체
 * @param {Object} source - 소스 객체
 * @returns {Object} 병합된 객체
 */
export function deepMerge(target, source) {
    const result = { ...target };
    
    for (const key of Object.keys(source)) {
        if (source[key] instanceof Object && key in target && target[key] instanceof Object) {
            result[key] = deepMerge(target[key], source[key]);
        } else {
            result[key] = source[key];
        }
    }
    
    return result;
}

/**
 * 문자열 자르기 (말줄임표 추가)
 * @param {string} str - 원본 문자열
 * @param {number} maxLength - 최대 길이
 * @returns {string} 잘린 문자열
 */
export function truncateString(str, maxLength) {
    if (!str || str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
}
