/**
 * IAGF - Regeneration Modal
 * 이미지 재생성 모달 UI (Enhanced version with full NAI options)
 */

import { extensionName } from '../core/constants.js';

let currentRegenMesId = null;
let currentRegenParams = null;
let isRegenerating = false;
let onRegenerateCallback = null;

/**
 * 재생성 모달 초기화
 */
export function initRegenModal() {
    if ($('#iagf_regen_modal').length) return;
    
    const modalHtml = `
    <div id="iagf_regen_modal" class="iagf-regen-modal" style="display:none;">
        <div class="iagf-regen-modal-overlay"></div>
        <div class="iagf-regen-modal-content">
            <div class="iagf-regen-modal-header">
                <h4><i class="fa-solid fa-sliders"></i> Edit & Regenerate</h4>
                <button class="iagf-regen-modal-close"><i class="fa-solid fa-times"></i></button>
            </div>
            <div class="iagf-regen-modal-body">
                <div class="iagf-regen-field">
                    <label>Prompt</label>
                    <textarea id="iagf_regen_prompt" rows="3"></textarea>
                </div>
                <div class="iagf-regen-field">
                    <label>Negative Prompt</label>
                    <textarea id="iagf_regen_negative" rows="2"></textarea>
                </div>
                <div class="iagf-regen-row">
                    <div class="iagf-regen-field">
                        <label>Width</label>
                        <input type="number" id="iagf_regen_width" min="64" max="2048" step="64">
                    </div>
                    <div class="iagf-regen-field">
                        <label>Height</label>
                        <input type="number" id="iagf_regen_height" min="64" max="2048" step="64">
                    </div>
                </div>
                <div class="iagf-regen-row">
                    <div class="iagf-regen-field">
                        <label>Steps</label>
                        <input type="number" id="iagf_regen_steps" min="1" max="50">
                    </div>
                    <div class="iagf-regen-field">
                        <label>Scale (CFG)</label>
                        <input type="number" id="iagf_regen_scale" min="1" max="30" step="0.1">
                    </div>
                </div>
                <div class="iagf-regen-row">
                    <div class="iagf-regen-field">
                        <label>Seed (-1 = random)</label>
                        <input type="number" id="iagf_regen_seed" min="-1">
                    </div>
                    <div class="iagf-regen-field">
                        <label>Sampler</label>
                        <select id="iagf_regen_sampler">
                            <option value="k_euler_ancestral">Euler Ancestral</option>
                            <option value="k_euler">Euler</option>
                            <option value="k_dpmpp_2s_ancestral">DPM++ 2S Ancestral</option>
                            <option value="k_dpmpp_2m_sde">DPM++ 2M SDE</option>
                            <option value="k_dpmpp_sde">DPM++ SDE</option>
                        </select>
                    </div>
                </div>
                <div class="iagf-regen-row">
                    <div class="iagf-regen-field">
                        <label>CFG Rescale</label>
                        <input type="number" id="iagf_regen_cfg_rescale" min="0" max="1" step="0.01" value="0">
                    </div>
                    <div class="iagf-regen-field">
                        <label>Variety+</label>
                        <select id="iagf_regen_variety">
                            <option value="false">Off</option>
                            <option value="true">On</option>
                        </select>
                    </div>
                </div>
            </div>
            <div class="iagf-regen-modal-footer">
                <button class="iagf-regen-modal-btn" id="iagf_regen_cancel">Cancel</button>
                <button class="iagf-regen-modal-btn primary" id="iagf_regen_generate"><i class="fa-solid fa-rotate"></i> Regenerate</button>
            </div>
        </div>
    </div>
    `;
    $('body').append(modalHtml);
    
    // 모달 이벤트 바인딩
    $('#iagf_regen_modal .iagf-regen-modal-overlay, #iagf_regen_modal .iagf-regen-modal-close, #iagf_regen_cancel')
        .on('click', closeRegenModal);
    $('#iagf_regen_generate').on('click', executeRegeneration);
}

/**
 * 재생성 모달 열기
 * @param {number} mesId - 메시지 ID
 * @param {Object} genParams - 생성 파라미터
 * @param {Function} onRegenerate - 재생성 콜백 (mesId, params) => Promise
 */
export function openRegenModal(mesId, genParams, onRegenerate) {
    initRegenModal();
    currentRegenMesId = mesId;
    currentRegenParams = genParams || {};
    onRegenerateCallback = onRegenerate;
    
    // 필드에 값 채우기
    $('#iagf_regen_prompt').val(currentRegenParams.prompt || '');
    $('#iagf_regen_negative').val(currentRegenParams.negativePrompt || '');
    $('#iagf_regen_width').val(currentRegenParams.width || 832);
    $('#iagf_regen_height').val(currentRegenParams.height || 1216);
    $('#iagf_regen_steps').val(currentRegenParams.steps || 28);
    $('#iagf_regen_scale').val(currentRegenParams.scale || 5.0);
    $('#iagf_regen_seed').val(-1); // 기본적으로 랜덤 시드
    $('#iagf_regen_sampler').val(currentRegenParams.sampler || 'k_euler_ancestral');
    $('#iagf_regen_cfg_rescale').val(currentRegenParams.cfgRescale ?? 0);
    $('#iagf_regen_variety').val(currentRegenParams.variety ? 'true' : 'false');
    
    $('#iagf_regen_modal').fadeIn(150);
}

/**
 * 재생성 모달 닫기
 */
export function closeRegenModal() {
    $('#iagf_regen_modal').fadeOut(150);
    currentRegenMesId = null;
    currentRegenParams = null;
}

/**
 * 재생성 실행
 */
async function executeRegeneration() {
    if (currentRegenMesId === null || isRegenerating) return;
    
    const $btn = $('#iagf_regen_generate');
    isRegenerating = true;
    $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Generating...');
    
    try {
        // 모달에서 값 가져오기
        const prompt = $('#iagf_regen_prompt').val().trim();
        const negativePrompt = $('#iagf_regen_negative').val().trim();
        const width = parseInt($('#iagf_regen_width').val()) || 832;
        const height = parseInt($('#iagf_regen_height').val()) || 1216;
        const steps = parseInt($('#iagf_regen_steps').val()) || 28;
        const scale = parseFloat($('#iagf_regen_scale').val()) || 5.0;
        let seed = parseInt($('#iagf_regen_seed').val());
        const sampler = $('#iagf_regen_sampler').val() || 'k_euler_ancestral';
        const cfgRescale = parseFloat($('#iagf_regen_cfg_rescale').val()) || 0;
        const variety = $('#iagf_regen_variety').val() === 'true';
        
        if (seed < 0) {
            seed = Math.floor(Math.random() * 2147483647);
        }
        
        if (!prompt) {
            toastr.warning('Prompt is required');
            return;
        }
        
        const params = {
            prompt,
            negativePrompt,
            width,
            height,
            steps,
            scale,
            seed,
            sampler,
            cfgRescale,
            variety,
            vibeTransfer: currentRegenParams.vibeTransfer,
            characterReference: currentRegenParams.characterReference,
        };
        
        if (onRegenerateCallback) {
            await onRegenerateCallback(currentRegenMesId, params);
        }
        
        closeRegenModal();
    } catch (error) {
        console.error(`[${extensionName}] Regeneration error:`, error);
        toastr.error(`Regeneration failed: ${error.message}`);
    } finally {
        isRegenerating = false;
        $btn.prop('disabled', false).html('<i class="fa-solid fa-rotate"></i> Regenerate');
    }
}

/**
 * 현재 재생성 대상 메시지 ID
 */
export function getCurrentRegenMesId() {
    return currentRegenMesId;
}

/**
 * 재생성 중인지 확인
 */
export function isCurrentlyRegenerating() {
    return isRegenerating;
}
