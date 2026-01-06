/**
 * IAGF - Message Buttons Module
 * 메시지에 이미지 생성/재생성 버튼 추가
 */

import { extensionName } from '../core/constants.js';
import { escapeHtmlAttribute } from '../core/utils.js';

/**
 * 메시지 버튼 관리 클래스
 */
export class MessageButtonsManager {
    constructor(options) {
        this.settings = options.settings;
        this.getContext = options.getContext;
        this.generateImage = options.generateImage;
        this.applyPreset = options.applyPreset;
        this.getExtraParams = options.getExtraParams;
        this.initialized = false;
    }

    /**
     * 초기화
     */
    initialize(eventSource, event_types) {
        if (this.initialized) return;
        this.initialized = true;

        this.bindEvents(eventSource, event_types);
        this.injectStyles();
        
        // 초기 버튼 추가
        setTimeout(() => this.resetAllButtons(), 500);
    }

    /**
     * 이벤트 바인딩
     */
    bindEvents(eventSource, event_types) {
        if (!eventSource || !event_types) return;

        eventSource.on(event_types.CHAT_CHANGED, () => {
            setTimeout(() => this.resetAllButtons(), 100);
        });

        eventSource.on(event_types.MESSAGE_RECEIVED, (mesId) => {
            setTimeout(() => this.addButtonForMesId(mesId), 100);
        });

        if (event_types.CHARACTER_MESSAGE_RENDERED) {
            eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (mesId) => {
                setTimeout(() => this.addButtonForMesId(mesId), 100);
            });
        }

        if (event_types.USER_MESSAGE_RENDERED) {
            eventSource.on(event_types.USER_MESSAGE_RENDERED, (mesId) => {
                setTimeout(() => this.addButtonForMesId(mesId), 100);
            });
        }
    }

    /**
     * 모든 메시지에 버튼 추가
     */
    resetAllButtons() {
        $('#chat > .mes[mesid]').each((_, el) => {
            this.addButtonToMessage(el);
        });
    }

    /**
     * 특정 메시지에 버튼 추가
     */
    addButtonForMesId(mesId) {
        const message = $(`.mes[mesid="${mesId}"]`);
        if (message.length) {
            this.addButtonToMessage(message[0]);
        }
    }

    /**
     * 메시지 요소에 버튼 추가
     */
    addButtonToMessage(mesElement) {
        const $mes = $(mesElement);
        let extraMesButtons = $mes.find('.extraMesButtons');

        if (!extraMesButtons.length) {
            const mesButtons = $mes.find('.mes_buttons');
            if (mesButtons.length) {
                mesButtons.append('<div class="extraMesButtons"></div>');
                extraMesButtons = $mes.find('.extraMesButtons');
            }
        }

        if (!extraMesButtons.length || extraMesButtons.find('.iagf_img_btn').length) {
            return;
        }

        const $button = $(
            '<div title="Generate Image from Message" class="mes_button iagf_img_btn fa-solid fa-panorama interactable" tabindex="0" role="button"></div>'
        );

        $button.on('click', (e) => this.handleButtonClick(e, $mes));
        extraMesButtons.prepend($button);
    }

    /**
     * 버튼 클릭 핸들러
     */
    async handleButtonClick(e, $mes) {
        e.stopPropagation();
        e.preventDefault();

        const $button = $(e.currentTarget);
        if ($button.hasClass('generating')) return;

        $button.addClass('generating');

        try {
            const mesId = $mes.attr('mesid');
            const context = this.getContext();
            const message = context.chat[mesId];

            if (!message) {
                toastr.error('Message not found');
                return;
            }

            await this.generateImageForMessage(message, $mes, mesId);
        } catch (error) {
            console.error(`[${extensionName}] Error:`, error);
            toastr.error(`Image generation failed: ${error.message}`);
        } finally {
            $button.removeClass('generating');
        }
    }

    /**
     * 메시지에서 이미지 생성
     */
    async generateImageForMessage(message, $mes, mesId) {
        // 구현은 index.js에서 주입
        if (this.generateImage) {
            await this.generateImage(message, $mes, mesId);
        }
    }

    /**
     * 스타일 주입
     */
    injectStyles() {
        if ($('#iagf-message-btn-styles').length) return;

        $('head').append(`
            <style id="iagf-message-btn-styles">
                .iagf_img_btn.generating {
                    animation: iagf-pulse 1s infinite;
                    pointer-events: none;
                }
                @keyframes iagf-pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            </style>
        `);
    }
}

/**
 * 이미지 재생성 버튼 관리 클래스
 */
export class RegenButtonsManager {
    constructor(options) {
        this.settings = options.settings;
        this.getContext = options.getContext;
        this.regenerate = options.regenerate;
        this.openModal = options.openModal;
    }

    /**
     * 초기화
     */
    initialize(eventSource, event_types) {
        this.bindEvents(eventSource, event_types);
        this.bindDocumentEvents();
        this.injectStyles();
        
        setTimeout(() => this.addButtonsToAllImages(), 1500);
    }

    /**
     * 이벤트 바인딩
     */
    bindEvents(eventSource, event_types) {
        if (!eventSource || !event_types) return;

        eventSource.on(event_types.CHAT_CHANGED, () => {
            setTimeout(() => this.addButtonsToAllImages(), 500);
        });

        const addForMesId = (mesId) => {
            setTimeout(() => {
                const $mes = $(`.mes[mesid="${mesId}"]`);
                if ($mes.length) this.addButtonsToImage($mes[0]);
            }, 500);
        };

        eventSource.on(event_types.MESSAGE_RECEIVED, addForMesId);
        
        if (event_types.CHARACTER_MESSAGE_RENDERED) {
            eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, addForMesId);
        }
        
        if (event_types.MESSAGE_UPDATED) {
            eventSource.on(event_types.MESSAGE_UPDATED, addForMesId);
        }
    }

    /**
     * 문서 레벨 이벤트 바인딩
     */
    bindDocumentEvents() {
        $(document).off('click.iagf_regen').on('click.iagf_regen', '.iagf-regen-btn', async (e) => {
            e.stopPropagation();
            e.preventDefault();

            const $btn = $(e.currentTarget);
            const action = $btn.data('action');
            const mesId = $btn.data('mesid');

            if ($btn.prop('disabled')) return;

            if (action === 'reseed') {
                $btn.prop('disabled', true).addClass('generating');
                try {
                    await this.regenerate(mesId);
                } finally {
                    $btn.prop('disabled', false).removeClass('generating');
                }
            } else if (action === 'edit') {
                this.openModal(mesId);
            }
        });
    }

    /**
     * 모든 이미지에 버튼 추가
     */
    addButtonsToAllImages() {
        $('#chat > .mes[mesid]').each((_, el) => {
            this.addButtonsToImage(el);
        });
    }

    /**
     * 이미지 컨테이너에 버튼 추가
     */
    addButtonsToImage(mesElement) {
        const $mes = $(mesElement);
        const mesId = $mes.attr('mesid');

        let $imgContainer = $mes.find('.mes_img_container');
        if (!$imgContainer.length) {
            $imgContainer = $mes.find('.mes_block .mes_img_wrapper');
        }
        
        const $img = $mes.find('.mes_img, .mes_block img[src*="data:image"], .mes_block img[src*="user_upload"]');
        if ($img.length && !$imgContainer.length) {
            $imgContainer = $img.parent();
        }

        if (!$imgContainer.length || $imgContainer.find('.iagf-regen-container').length) {
            return;
        }

        const context = this.getContext();
        const message = context.chat[mesId];
        const hasMedia = message?.extra?.media?.length > 0;
        const hasImage = $img.length > 0;
        
        if (!hasMedia && !hasImage) return;

        if ($imgContainer.css('position') === 'static') {
            $imgContainer.css('position', 'relative');
        }

        const $container = $(`
            <div class="iagf-regen-container">
                <button class="iagf-regen-btn" data-action="reseed" data-mesid="${mesId}" title="Regenerate with new seed">
                    <i class="fa-solid fa-dice"></i> Reseed
                </button>
                <button class="iagf-regen-btn" data-action="edit" data-mesid="${mesId}" title="Edit and regenerate">
                    <i class="fa-solid fa-pen"></i> Edit
                </button>
            </div>
        `);

        $imgContainer.append($container);
    }

    /**
     * 스타일 주입
     */
    injectStyles() {
        if ($('#iagf-regen-btn-styles').length) return;

        $('head').append(`
            <style id="iagf-regen-btn-styles">
                .iagf-regen-container {
                    position: absolute;
                    bottom: 8px;
                    right: 8px;
                    display: flex;
                    gap: 4px;
                    opacity: 0;
                    transition: opacity 0.2s;
                    z-index: 10;
                }
                .mes_img_container:hover .iagf-regen-container {
                    opacity: 1;
                }
                .iagf-regen-btn {
                    background: rgba(0, 0, 0, 0.7);
                    border: 1px solid #444;
                    color: #ccc;
                    padding: 4px 8px;
                    font-size: 11px;
                    border-radius: 3px;
                    cursor: pointer;
                }
                .iagf-regen-btn:hover {
                    background: rgba(0, 0, 0, 0.9);
                    color: #fff;
                }
                .iagf-regen-btn.generating {
                    animation: iagf-pulse 1s infinite;
                }
            </style>
        `);
    }
}
