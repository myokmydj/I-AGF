/**
 * IAGF - NAI API Module
 * NovelAI 이미지 생성 API 통신
 */

import { API_ENDPOINTS, DEFAULT_IMAGE_PARAMS } from '../core/constants.js';

/**
 * NAI API 호출 클래스
 */
export class NAIApiClient {
    constructor(getRequestHeaders, sdSettings) {
        this.getRequestHeaders = getRequestHeaders;
        this.sdSettings = sdSettings;
    }

    /**
     * 이미지 생성 요청 본문 구성
     */
    buildRequestBody(prompt, params = {}) {
        const sd = this.sdSettings() || {};
        
        const model = params.model || sd.model || DEFAULT_IMAGE_PARAMS.model;
        const sampler = params.sampler || sd.sampler || DEFAULT_IMAGE_PARAMS.sampler;
        const scheduler = params.scheduler || sd.scheduler || DEFAULT_IMAGE_PARAMS.scheduler;
        const steps = Math.min(params.steps || sd.steps || DEFAULT_IMAGE_PARAMS.steps, 50);
        const scale = parseFloat(params.scale || sd.scale) || DEFAULT_IMAGE_PARAMS.scale;
        const width = parseInt(params.width || sd.width) || DEFAULT_IMAGE_PARAMS.width;
        const height = parseInt(params.height || sd.height) || DEFAULT_IMAGE_PARAMS.height;
        const seed = params.seed >= 0 ? params.seed : Math.floor(Math.random() * 2147483647);
        const negativePrompt = params.negativePrompt || '';
        const cfgRescale = parseFloat(params.cfgRescale) || 0;
        const variety = params.variety === true;

        const body = {
            input: prompt,
            model: model,
            action: 'generate',
            parameters: {
                params_version: 3,
                width,
                height,
                noise_schedule: scheduler,
                controlnet_strength: 1,
                dynamic_thresholding: false,
                scale,
                cfg_rescale: cfgRescale,
                sampler,
                steps,
                seed,
                n_samples: 1,
                ucPreset: 0,
                negative_prompt: negativePrompt,
                qualityToggle: true,
                use_coords: false,
                legacy: false,
                legacy_v3_extend: false,
                prefer_brownian: variety,
                autoSmea: false,
                v4_prompt: {
                    caption: {
                        base_caption: prompt,
                        char_captions: [],
                    },
                    use_coords: false,
                    use_order: true,
                },
                v4_negative_prompt: {
                    caption: {
                        base_caption: negativePrompt,
                        char_captions: [],
                    },
                    legacy_uc: false,
                },
            },
        };

        // Vibe Transfer 추가
        if (params.vibeTransfer) {
            const vibe = params.vibeTransfer;
            body.parameters.reference_image_multiple = [vibe.image];
            body.parameters.reference_strength_multiple = [parseFloat(vibe.strength) || 0.6];
            body.parameters.reference_information_extracted_multiple = [parseFloat(vibe.infoExtracted) || 1.0];
        }

        // Character Reference 추가
        if (params.characterReference) {
            const charRef = params.characterReference;
            const charRefImages = charRef.images || [];
            body.parameters.director_reference_images = charRefImages;
            body.parameters.director_reference_strength_values = charRefImages.map(() => 1.0);
            body.parameters.director_reference_information_extracted = charRefImages.map(() => 1.0);
            const fidelityVal = parseFloat(charRef.fidelity) || 0.6;
            body.parameters.director_reference_secondary_strength_values = charRefImages.map(() => 1.0 - fidelityVal);
            
            const caption = charRef.styleAware ? 'character&style' : 'character';
            body.parameters.director_reference_descriptions = charRefImages.map(() => ({
                caption: {
                    base_caption: caption,
                    char_captions: [],
                },
                legacy_uc: false,
            }));
        }

        // Character Prompts (v4) 추가
        if (params.characterPrompts?.length > 0) {
            body.parameters.v4_prompt.caption.char_captions = params.characterPrompts.map(cp => ({
                char_caption: cp.prompt,
                centers: params.characterPositionEnabled ? [cp.position] : [{ x: 0.5, y: 0.5 }],
            }));
            body.parameters.v4_prompt.use_coords = params.characterPositionEnabled || false;

            // 캐릭터별 네거티브 프롬프트
            body.parameters.v4_negative_prompt.caption.char_captions = params.characterPrompts.map(cp => ({
                char_caption: cp.negative || '',
                centers: [{ x: 0.5, y: 0.5 }],
            }));
        }

        return body;
    }

    /**
     * 플러그인 API로 이미지 생성
     */
    async generateWithPlugin(requestBody) {
        const response = await fetch(API_ENDPOINTS.NAI_PLUGIN, {
            method: 'POST',
            headers: this.getRequestHeaders(),
            body: JSON.stringify(requestBody),
        });

        if (response.status === 404) {
            throw new Error('Plugin not available');
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`NAI Plugin error: ${response.status} - ${errorText}`);
        }

        return await response.text();
    }

    /**
     * 기본 API로 이미지 생성 (폴백)
     */
    async generateWithFallback(prompt, params) {
        const sd = this.sdSettings() || {};

        const body = {
            prompt,
            model: params.model || sd.model || DEFAULT_IMAGE_PARAMS.model,
            sampler: params.sampler || sd.sampler || DEFAULT_IMAGE_PARAMS.sampler,
            scheduler: params.scheduler || sd.scheduler || DEFAULT_IMAGE_PARAMS.scheduler,
            steps: Math.min(params.steps || sd.steps || DEFAULT_IMAGE_PARAMS.steps, 50),
            scale: parseFloat(params.scale || sd.scale) || DEFAULT_IMAGE_PARAMS.scale,
            width: parseInt(params.width || sd.width) || DEFAULT_IMAGE_PARAMS.width,
            height: parseInt(params.height || sd.height) || DEFAULT_IMAGE_PARAMS.height,
            negative_prompt: params.negativePrompt || '',
            seed: params.seed >= 0 ? params.seed : Math.floor(Math.random() * 2147483647),
        };

        const response = await fetch(API_ENDPOINTS.NAI_FALLBACK, {
            method: 'POST',
            headers: this.getRequestHeaders(),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`NAI API error: ${response.status} - ${errorText}`);
        }

        return await response.text();
    }

    /**
     * 이미지 생성 (자동 폴백)
     */
    async generate(prompt, params = {}) {
        const requestBody = this.buildRequestBody(prompt, params);

        try {
            return await this.generateWithPlugin(requestBody);
        } catch (pluginError) {
            console.log('[IAGF] Plugin API failed, using fallback API:', pluginError.message);
            return await this.generateWithFallback(prompt, params);
        }
    }

    /**
     * 미리보기용 작은 이미지 생성
     */
    async generatePreview(prompt, negativePrompt = '') {
        return await this.generate(prompt, {
            width: 512,
            height: 768,
            negativePrompt,
        });
    }
}
