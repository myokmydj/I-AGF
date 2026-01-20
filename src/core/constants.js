/**
 * IAGF - Constants Module
 * 확장 프로그램 전역 상수 정의
 */

export const extensionName = 'I-AGF';
export const extensionFolderPath = `/scripts/extensions/third-party/${extensionName}`;

/**
 * 현재 버전 (업데이트 알림용)
 */
export const EXTENSION_VERSION = '2.0.0';

/**
 * 이미지 삽입 타입
 */
export const INSERT_TYPE = {
    DISABLED: 'disabled',
    INLINE: 'inline',
    NEW_MESSAGE: 'new',
    REPLACE: 'replace',
};

/**
 * 프롬프트 인젝션 위치
 */
export const INJECTION_POSITION = {
    DEEP_SYSTEM: 'deep_system',
    DEEP_USER: 'deep_user',
    DEEP_ASSISTANT: 'deep_assistant',
};

/**
 * 캐릭터 프롬프트 색상 팔레트
 */
export const CHARACTER_COLORS = [
    '#22c55e', // green
    '#ef4444', // red
    '#3b82f6', // blue
    '#f59e0b', // amber
    '#a855f7', // purple
    '#06b6d4', // cyan
];

/**
 * 기본 이미지 생성 파라미터
 */
export const DEFAULT_IMAGE_PARAMS = {
    width: 832,
    height: 1216,
    steps: 28,
    scale: 5.0,
    sampler: 'k_euler_ancestral',
    scheduler: 'native',
    model: 'nai-diffusion-4-5-full',
};

/**
 * API 엔드포인트
 */
export const API_ENDPOINTS = {
    NAI_PLUGIN: '/api/plugins/nai-reference-image/generate',
    NAI_FALLBACK: '/api/novelai/generate-image',
};
