import { extensionName, INSERT_TYPE } from '../../core/constants.js';
import { escapeHtmlAttribute } from '../../core/utils.js';

export class DashboardModal {
    constructor(options) {
        this.settings = options.settings;
        this.managers = options.managers;
        this.saveSettings = options.saveSettings;
        this.onUpdate = options.onUpdate || (() => {});
        this.getConnectionProfiles = options.getConnectionProfiles || (() => []);
        this.generatePreview = options.generatePreview || null;
        
        this.currentPage = 'home';
        this.isOpen = false;
        this.$modal = null;
        this.generatingPreviews = new Set();
    }

    initialize() {
        this.injectModal();
        this.bindEvents();
    }

    injectModal() {
        if ($('#iagf-dashboard-modal').length) return;

        const html = `
        <div id="iagf-dashboard-modal" class="iagf-dashboard" style="display:none;">
            <div class="iagf-dashboard-overlay"></div>
            <div class="iagf-dashboard-container">
                <!-- 사이드바 -->
                <aside class="iagf-sidebar">
                    <div class="iagf-sidebar-header">
                        <div class="iagf-logo">
                            <i class="fa-solid fa-wand-magic-sparkles"></i>
                            <span>IAGF</span>
                        </div>
                    </div>
                    <nav class="iagf-nav">
                        <a href="#" class="iagf-nav-item active" data-page="home">
                            <i class="fa-solid fa-house"></i>
                            <span>홈</span>
                        </a>
                        <a href="#" class="iagf-nav-item" data-page="presets">
                            <i class="fa-solid fa-sliders"></i>
                            <span>프리셋</span>
                        </a>
                        <a href="#" class="iagf-nav-item" data-page="vibe">
                            <i class="fa-solid fa-palette"></i>
                            <span>Vibe Transfer</span>
                        </a>
                        <a href="#" class="iagf-nav-item" data-page="charref">
                            <i class="fa-solid fa-user"></i>
                            <span>캐릭터 레퍼런스</span>
                        </a>
                        <a href="#" class="iagf-nav-item" data-page="charprompts">
                            <i class="fa-solid fa-users"></i>
                            <span>캐릭터 프롬프트</span>
                        </a>
                        <a href="#" class="iagf-nav-item" data-page="tags">
                            <i class="fa-solid fa-tags"></i>
                            <span>태그 매칭</span>
                        </a>
                        <div class="iagf-nav-divider"></div>
                        <a href="#" class="iagf-nav-item" data-page="settings">
                            <i class="fa-solid fa-gear"></i>
                            <span>설정</span>
                        </a>
                    </nav>
                </aside>

                <!-- 메인 콘텐츠 -->
                <main class="iagf-main">
                    <header class="iagf-header">
                        <h1 class="iagf-page-title">홈</h1>
                        <div class="iagf-header-actions">
                            <div class="iagf-status-badge" id="iagf-status-badge">
                                <span class="status-dot"></span>
                                <span class="status-text">준비됨</span>
                            </div>
                            <button class="iagf-close-btn" title="닫기">
                                <i class="fa-solid fa-times"></i>
                            </button>
                        </div>
                    </header>
                    <div class="iagf-content" id="iagf-content">
                        <!-- 페이지 내용이 여기에 렌더링됨 -->
                    </div>
                </main>
            </div>
        </div>`;

        $('body').append(html);
        this.$modal = $('#iagf-dashboard-modal');
    }

    bindEvents() {
        // 오버레이 클릭으로 닫기
        this.$modal.find('.iagf-dashboard-overlay').on('click', () => this.close());
        
        // 닫기 버튼
        this.$modal.find('.iagf-close-btn').on('click', () => this.close());

        // 네비게이션
        this.$modal.find('.iagf-nav-item').on('click', (e) => {
            e.preventDefault();
            const page = $(e.currentTarget).data('page');
            this.navigateTo(page);
        });

        // ESC 키로 닫기
        $(document).on('keydown.iagf-dashboard', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        });
    }

    open() {
        this.isOpen = true;
        this.$modal.fadeIn(200);
        this.renderPage(this.currentPage);
        $('body').addClass('iagf-modal-open');
    }

    close() {
        this.isOpen = false;
        this.$modal.fadeOut(200);
        $('body').removeClass('iagf-modal-open');
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    navigateTo(page) {
        this.currentPage = page;
        
        // 네비게이션 활성화 상태 업데이트
        this.$modal.find('.iagf-nav-item').removeClass('active');
        this.$modal.find(`.iagf-nav-item[data-page="${page}"]`).addClass('active');
        
        // 페이지 타이틀 업데이트
        const titles = {
            home: '홈',
            presets: '프리셋',
            vibe: 'Vibe Transfer',
            charref: '캐릭터 레퍼런스',
            charprompts: '캐릭터 프롬프트',
            tags: '태그 매칭',
            settings: '설정',
        };
        this.$modal.find('.iagf-page-title').text(titles[page] || page);
        
        this.renderPage(page);
    }

    renderPage(page) {
        const $content = this.$modal.find('#iagf-content');
        
        switch (page) {
            case 'home':
                $content.html(this.renderHomePage());
                break;
            case 'presets':
                $content.html(this.renderPresetsPage());
                this.bindPresetsEvents();
                break;
            case 'vibe':
                $content.html(this.renderVibePage());
                this.bindVibeEvents();
                break;
            case 'charref':
                $content.html(this.renderCharRefPage());
                this.bindCharRefEvents();
                break;
            case 'charprompts':
                $content.html(this.renderCharPromptsPage());
                this.bindCharPromptsEvents();
                break;
            case 'tags':
                $content.html(this.renderTagsPage());
                this.bindTagsEvents();
                break;
            case 'settings':
                $content.html(this.renderSettingsPage());
                this.bindSettingsEvents();
                break;
            default:
                $content.html('<p>페이지를 찾을 수 없습니다.</p>');
        }
    }

    renderHomePage() {
        const presetName = this.settings.presets[this.settings.currentPreset]?.name || 'Default';
        const vibeStatus = this.managers.vibeTransfer?.getStatus() || {};
        const charRefStatus = this.managers.characterRef?.getStatus() || {};
        const auxStatus = this.managers.auxiliaryModel?.getStatus() || {};

        return `
        <div class="iagf-home">
            <!-- 상태 카드 -->
            <div class="iagf-stats-grid">
                <div class="iagf-stat-card">
                    <div class="stat-icon"><i class="fa-solid fa-image"></i></div>
                    <div class="stat-info">
                        <div class="stat-value">-</div>
                        <div class="stat-label">총 생성 이미지</div>
                    </div>
                </div>
                <div class="iagf-stat-card">
                    <div class="stat-icon"><i class="fa-solid fa-clock"></i></div>
                    <div class="stat-info">
                        <div class="stat-value">0초</div>
                        <div class="stat-label">평균 생성 시간</div>
                    </div>
                </div>
                <div class="iagf-stat-card">
                    <div class="stat-icon"><i class="fa-solid fa-check-circle"></i></div>
                    <div class="stat-info">
                        <div class="stat-value">${this.countActiveFeatures()}</div>
                        <div class="stat-label">활성화된 기능</div>
                    </div>
                </div>
            </div>

            <!-- 현재 상태 -->
            <div class="iagf-section">
                <h2 class="iagf-section-title">
                    <i class="fa-solid fa-circle-info"></i>
                    현재 상태
                </h2>
                <div class="iagf-status-list">
                    <div class="status-item ${this.settings.currentPreset !== 'default' ? 'active' : ''}">
                        <span class="status-name">프리셋</span>
                        <span class="status-value">${escapeHtmlAttribute(presetName)}</span>
                    </div>
                    <div class="status-item ${vibeStatus.active ? 'active' : ''}">
                        <span class="status-name">Vibe Transfer</span>
                        <span class="status-value">${vibeStatus.text || 'Not set'}</span>
                    </div>
                    <div class="status-item ${charRefStatus.active ? 'active' : ''}">
                        <span class="status-name">캐릭터 레퍼런스</span>
                        <span class="status-value">${charRefStatus.text || 'Not set'}</span>
                    </div>
                    <div class="status-item ${auxStatus.active ? 'active' : ''}">
                        <span class="status-name">보조 모델</span>
                        <span class="status-value">${auxStatus.text || 'Disabled'}</span>
                    </div>
                </div>
            </div>

            <!-- 빠른 시작 가이드 -->
            <div class="iagf-section">
                <h2 class="iagf-section-title">
                    <i class="fa-solid fa-rocket"></i>
                    빠른 시작
                </h2>
                <div class="iagf-guide-steps">
                    <div class="guide-step">
                        <div class="step-number">1</div>
                        <div class="step-content">
                            <h4>프리셋 설정</h4>
                            <p>이미지 스타일과 품질 태그를 정의합니다</p>
                        </div>
                    </div>
                    <div class="guide-step">
                        <div class="step-number">2</div>
                        <div class="step-content">
                            <h4>Vibe Transfer (선택)</h4>
                            <p>참조 이미지의 분위기를 적용합니다</p>
                        </div>
                    </div>
                    <div class="guide-step">
                        <div class="step-number">3</div>
                        <div class="step-content">
                            <h4>채팅 시작</h4>
                            <p>AI가 자동으로 이미지 프롬프트를 생성합니다</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    countActiveFeatures() {
        let count = 0;
        if (this.settings.currentPreset !== 'default') count++;
        if (this.managers.vibeTransfer?.getStatus()?.active) count++;
        if (this.managers.characterRef?.getStatus()?.active) count++;
        if (this.managers.characterPrompts?.getStatus()?.active) count++;
        if (this.managers.auxiliaryModel?.getStatus()?.active) count++;
        if (this.managers.tagMatching?.getStatus()?.ready) count++;
        return count;
    }

    renderConnectionProfileOptions(selectedId) {
        const profiles = this.getConnectionProfiles();
        return profiles.map(p => `
            <option value="${escapeHtmlAttribute(p.id)}" ${p.id === selectedId ? 'selected' : ''}>
                ${escapeHtmlAttribute(p.name || p.id)}
            </option>
        `).join('');
    }

    renderPresetsPage() {
        const presets = this.managers.presets?.getPresetList() || [];
        const currentPreset = this.settings.presets[this.settings.currentPreset] || {};

        const presetItems = presets.map(p => {
            const presetData = this.settings.presets[p.key] || {};
            const isGenerating = this.generatingPreviews?.has(p.key);
            return `
            <div class="iagf-preset-item ${p.isActive ? 'active' : ''}" data-preset-key="${p.key}">
                <div class="preset-preview" data-preset-key="${p.key}">
                    ${isGenerating 
                        ? `<div class="preview-generating"><i class="fa-solid fa-spinner"></i><span>생성 중...</span></div>`
                        : (presetData.previewImage 
                            ? `<img src="${presetData.previewImage}" alt="${escapeHtmlAttribute(p.name)}">` 
                            : '<i class="fa-solid fa-image"></i>')}
                </div>
                <div class="preset-info">
                    <span class="preset-name">${escapeHtmlAttribute(p.name)}</span>
                    ${p.isActive ? '<span class="preset-badge">Active</span>' : ''}
                    <div class="preset-actions">
                        ${p.key !== 'default' ? `<button class="btn-delete-preset" data-preset-key="${p.key}"><i class="fa-solid fa-trash"></i></button>` : ''}
                    </div>
                </div>
            </div>
        `}).join('');

        return `
        <div class="iagf-presets-page">
            <div class="iagf-presets-layout">
                <div class="iagf-presets-sidebar">
                    <div class="presets-header">
                        <h3>프리셋 목록</h3>
                        <button class="iagf-btn iagf-btn-primary" id="btn-add-preset">
                            <i class="fa-solid fa-plus"></i> 추가
                        </button>
                    </div>
                    <div class="presets-list">
                        ${presetItems}
                    </div>
                </div>
                <div class="iagf-presets-editor">
                    <div class="editor-header">
                        <input type="text" id="preset-name-input" class="iagf-input" 
                            value="${escapeHtmlAttribute(currentPreset.name || '')}" 
                            placeholder="프리셋 이름">
                    </div>
                    <div class="editor-fields">
                        <div class="field-group">
                            <label>Prefix Prompt</label>
                            <textarea id="preset-prefix" class="iagf-textarea" rows="3" 
                                placeholder="이미지 프롬프트 앞에 추가됩니다">${escapeHtmlAttribute(currentPreset.prefixPrompt || '')}</textarea>
                        </div>
                        <div class="field-group">
                            <label>Suffix Prompt</label>
                            <textarea id="preset-suffix" class="iagf-textarea" rows="3" 
                                placeholder="이미지 프롬프트 뒤에 추가됩니다">${escapeHtmlAttribute(currentPreset.suffixPrompt || '')}</textarea>
                        </div>
                        <div class="field-group">
                            <label>Negative Prompt</label>
                            <textarea id="preset-negative" class="iagf-textarea" rows="3" 
                                placeholder="제외할 요소들">${escapeHtmlAttribute(currentPreset.negativePrompt || '')}</textarea>
                        </div>
                        <div class="field-group">
                            <button class="iagf-btn iagf-btn-primary" id="btn-generate-preview" ${this.generatingPreviews?.has(this.settings.currentPreset) ? 'disabled' : ''}>
                                <i class="fa-solid fa-wand-magic-sparkles"></i> 미리보기 생성
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    renderVibePage() {
        const vibeSettings = this.settings.vibeTransfer;
        const images = this.managers.vibeTransfer?.getImageList() || [];

        const imageItems = images.map(img => `
            <div class="iagf-vibe-item ${img.selected ? 'selected' : ''} ${!img.active ? 'disabled' : ''}" data-vibe-id="${img.id}">
                <div class="vibe-preview">
                    <img src="${img.data}" alt="${escapeHtmlAttribute(img.name)}">
                </div>
                <div class="vibe-info">
                    <span class="vibe-name">${escapeHtmlAttribute(img.name)}</span>
                    <div class="vibe-controls">
                        <button class="btn-toggle-vibe ${img.active ? 'active' : ''}" data-vibe-id="${img.id}">
                            <i class="fa-solid fa-${img.active ? 'eye' : 'eye-slash'}"></i>
                        </button>
                        <button class="btn-delete-vibe" data-vibe-id="${img.id}">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `).join('');

        return `
        <div class="iagf-vibe-page">
            <div class="iagf-section">
                <div class="section-header">
                    <h3>
                        <i class="fa-solid fa-palette"></i>
                        Vibe Transfer
                    </h3>
                    <label class="iagf-toggle">
                        <input type="checkbox" id="vibe-enabled" ${vibeSettings.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="toggle-label">활성화</span>
                    </label>
                </div>
            </div>

            <div class="iagf-section">
                <div class="section-header">
                    <h3>이미지 목록</h3>
                    <button class="iagf-btn iagf-btn-primary" id="btn-add-vibe">
                        <i class="fa-solid fa-plus"></i> 이미지 추가
                    </button>
                    <input type="file" id="vibe-upload" accept="image/*" style="display:none;">
                </div>
                <div class="iagf-vibe-grid">
                    ${images.length > 0 ? imageItems : '<div class="empty-state"><i class="fa-solid fa-image"></i><p>이미지를 추가해주세요</p></div>'}
                </div>
            </div>

            <div class="iagf-section">
                <h3>설정</h3>
                <div class="iagf-form-grid">
                    <div class="field-group">
                        <label>Strength: <span id="vibe-strength-value">${vibeSettings.defaultStrength}</span></label>
                        <input type="range" id="vibe-strength" class="iagf-range" 
                            min="0" max="1" step="0.05" value="${vibeSettings.defaultStrength}">
                    </div>
                    <div class="field-group">
                        <label>Info Extracted: <span id="vibe-info-value">${vibeSettings.defaultInfoExtracted}</span></label>
                        <input type="range" id="vibe-info-extracted" class="iagf-range" 
                            min="0" max="1" step="0.05" value="${vibeSettings.defaultInfoExtracted}">
                    </div>
                </div>
            </div>
        </div>`;
    }

    renderCharRefPage() {
        const charRefSettings = this.settings.characterReference;
        const botData = this.managers.characterRef?.getBotData();
        const characters = botData?.characters || {};
        const activeChar = botData?.activeCharacter;

        const charItems = Object.entries(characters).map(([name, data]) => {
            const imageCount = data.images?.length || 0;
            const isActive = name === activeChar;
            const isEnabled = data.enabled !== false;
            return `
                <div class="iagf-char-item ${isActive ? 'active' : ''} ${!isEnabled ? 'disabled' : ''}" data-char-name="${escapeHtmlAttribute(name)}">
                    <div class="char-preview">
                        ${data.images?.[0]?.data 
                            ? `<img src="${data.images[0].data}" alt="${escapeHtmlAttribute(name)}">` 
                            : '<i class="fa-solid fa-user"></i>'}
                    </div>
                    <div class="char-info">
                        <span class="char-name">${escapeHtmlAttribute(name)}</span>
                        <span class="char-meta">${imageCount} image(s)</span>
                    </div>
                    <div class="char-actions">
                        <label class="iagf-toggle mini" title="캐릭터 활성화">
                            <input type="checkbox" class="char-enabled-toggle" data-char-name="${escapeHtmlAttribute(name)}" ${isEnabled ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                        <button class="btn-delete-char" data-char-name="${escapeHtmlAttribute(name)}">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        const activeCharData = activeChar ? characters[activeChar] : null;
        const charImages = activeCharData?.images || [];

        const imageItems = charImages.map(img => {
            const isEnabled = img.enabled !== false;
            return `
            <div class="iagf-char-image ${activeCharData?.activeImageId === img.id ? 'selected' : ''} ${!isEnabled ? 'disabled' : ''}" 
                data-image-id="${img.id}" data-char-name="${escapeHtmlAttribute(activeChar)}">
                <img src="${img.data}" alt="${escapeHtmlAttribute(img.name || 'Image')}">
                <div class="image-overlay">
                    <label class="iagf-toggle mini" title="이미지 활성화">
                        <input type="checkbox" class="image-enabled-toggle" data-image-id="${img.id}" ${isEnabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                    <button class="btn-delete-char-image" data-image-id="${img.id}">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
            </div>
        `}).join('');

        return `
        <div class="iagf-charref-page">
            <div class="iagf-section">
                <div class="section-header">
                    <h3>
                        <i class="fa-solid fa-user"></i>
                        캐릭터 레퍼런스
                    </h3>
                    <label class="iagf-toggle">
                        <input type="checkbox" id="charref-enabled" ${charRefSettings.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="toggle-label">활성화</span>
                    </label>
                </div>
                <p class="section-desc">⚠️ NAI API 제한: 모든 캐릭터 통틀어 최대 1개의 이미지만 활성화할 수 있습니다.</p>
            </div>

            <div class="iagf-charref-layout">
                <div class="iagf-charref-sidebar">
                    <div class="charref-header">
                        <h4>캐릭터 목록</h4>
                        <div class="add-char-form">
                            <input type="text" id="new-char-name" class="iagf-input" placeholder="캐릭터 이름">
                            <button class="iagf-btn iagf-btn-primary" id="btn-add-char">
                                <i class="fa-solid fa-plus"></i>
                            </button>
                        </div>
                    </div>
                    <div class="charref-list">
                        ${Object.keys(characters).length > 0 ? charItems : '<div class="empty-state"><p>캐릭터를 추가해주세요</p></div>'}
                    </div>
                </div>

                <div class="iagf-charref-detail">
                    ${activeChar ? `
                        <div class="detail-header">
                            <h4>${escapeHtmlAttribute(activeChar)}</h4>
                            <button class="iagf-btn iagf-btn-primary" id="btn-add-char-image">
                                <i class="fa-solid fa-plus"></i> 이미지 추가
                            </button>
                            <input type="file" id="char-image-upload" accept="image/*" style="display:none;">
                        </div>
                        <div class="char-images-grid">
                            ${charImages.length > 0 ? imageItems : '<div class="empty-state"><i class="fa-solid fa-image"></i><p>이미지를 추가해주세요</p></div>'}
                        </div>
                        <div class="char-settings">
                            <div class="field-group">
                                <label>Fidelity: <span id="charref-fidelity-value">${activeCharData?.fidelity || charRefSettings.defaultFidelity}</span></label>
                                <input type="range" id="charref-fidelity" class="iagf-range" 
                                    min="0" max="1" step="0.05" value="${activeCharData?.fidelity || charRefSettings.defaultFidelity}">
                            </div>
                            <label class="iagf-toggle">
                                <input type="checkbox" id="charref-style-aware" ${activeCharData?.styleAware ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                                <span class="toggle-label">Style Aware</span>
                            </label>
                        </div>
                    ` : '<div class="empty-state"><i class="fa-solid fa-arrow-left"></i><p>캐릭터를 선택해주세요</p></div>'}
                </div>
            </div>
        </div>`;
    }

    renderCharPromptsPage() {
        const promptSettings = this.settings.characterPrompts;
        const characters = this.managers.characterPrompts?.getCharacterPrompts() || [];

        const charItems = characters.map((char, index) => {
            const color = this.managers.characterPrompts?.getColor(index) || '#a855f7';
            return `
                <div class="iagf-charprompt-item ${char.enabled ? 'active' : ''}" data-char-id="${char.id}">
                    <div class="charprompt-header">
                        <div class="charprompt-color" style="background-color: ${color}"></div>
                        <input type="text" class="iagf-input charprompt-name" data-char-id="${char.id}" 
                            value="${escapeHtmlAttribute(char.name || '')}" placeholder="캐릭터 이름">
                        <label class="iagf-toggle mini">
                            <input type="checkbox" class="charprompt-toggle" data-char-id="${char.id}" ${char.enabled ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                        <button class="btn-delete-charprompt" data-char-id="${char.id}">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                    <div class="charprompt-body">
                        <div class="field-group">
                            <label>Prompt</label>
                            <textarea class="iagf-textarea charprompt-prompt" data-char-id="${char.id}" rows="3" 
                                placeholder="캐릭터 프롬프트">${escapeHtmlAttribute(char.prompt || '')}</textarea>
                        </div>
                        <div class="field-group">
                            <label>Negative</label>
                            <textarea class="iagf-textarea charprompt-negative" data-char-id="${char.id}" rows="2" 
                                placeholder="제외할 요소">${escapeHtmlAttribute(char.negative || '')}</textarea>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        return `
        <div class="iagf-charprompts-page">
            <div class="iagf-section">
                <div class="section-header">
                    <h3>
                        <i class="fa-solid fa-users"></i>
                        캐릭터 프롬프트
                    </h3>
                    <label class="iagf-toggle">
                        <input type="checkbox" id="charprompts-enabled" ${promptSettings.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="toggle-label">활성화</span>
                    </label>
                </div>
                <p class="section-desc">각 캐릭터별로 개별 프롬프트를 지정합니다. (NAI v4 Character Prompts)</p>
            </div>

            <div class="iagf-section">
                <div class="section-header">
                    <h4>캐릭터 목록</h4>
                    <button class="iagf-btn iagf-btn-primary" id="btn-add-charprompt">
                        <i class="fa-solid fa-plus"></i> 캐릭터 추가
                    </button>
                </div>
                <div class="charprompts-list">
                    ${characters.length > 0 ? charItems : '<div class="empty-state"><i class="fa-solid fa-users"></i><p>캐릭터 프롬프트를 추가해주세요</p></div>'}
                </div>
            </div>

            <div class="iagf-section">
                <label class="iagf-toggle">
                    <input type="checkbox" id="charprompts-position" ${promptSettings.positionEnabled ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                    <span class="toggle-label">Position 사용</span>
                </label>
            </div>
        </div>`;
    }

    renderTagsPage() {
        const tagSettings = this.settings.tagMatching;
        const status = this.managers.tagMatching?.getStatus() || {};

        return `
        <div class="iagf-tags-page">
            <div class="iagf-section">
                <div class="section-header">
                    <h3>
                        <i class="fa-solid fa-tags"></i>
                        태그 매칭
                    </h3>
                    <label class="iagf-toggle">
                        <input type="checkbox" id="tags-enabled" ${tagSettings.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="toggle-label">활성화</span>
                    </label>
                </div>
                <p class="section-desc">Danbooru 태그 데이터베이스를 사용하여 프롬프트의 태그를 자동으로 매칭합니다.</p>
            </div>

            <div class="iagf-section">
                <h4>상태</h4>
                <div class="status-item ${status.ready ? 'active' : ''}">
                    <span class="status-name">태그 매처</span>
                    <span class="status-value">${status.text || 'Unknown'}</span>
                </div>
            </div>

            <div class="iagf-section">
                <h4>옵션</h4>
                <div class="iagf-options-list">
                    <label class="iagf-toggle">
                        <input type="checkbox" id="tags-fuzzy-best" ${tagSettings.useFuzzyBest ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="toggle-label">Fuzzy Best Match</span>
                    </label>
                    <p class="option-desc">유사한 태그 중 가장 적합한 것을 선택합니다.</p>

                    <label class="iagf-toggle">
                        <input type="checkbox" id="tags-keep-unmatched" ${tagSettings.keepUnmatched ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="toggle-label">Keep Unmatched</span>
                    </label>
                    <p class="option-desc">매칭되지 않은 태그를 그대로 유지합니다.</p>

                    <label class="iagf-toggle">
                        <input type="checkbox" id="tags-show-stats" ${tagSettings.showStats ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="toggle-label">Show Stats</span>
                    </label>
                    <p class="option-desc">콘솔에 매칭 통계를 출력합니다.</p>
                </div>
            </div>
        </div>`;
    }

    renderSettingsPage() {
        const settings = this.settings;
        const insertType = settings.insertType || INSERT_TYPE.DISABLED;

        return `
        <div class="iagf-settings-page">
            <div class="iagf-section">
                <h3>
                    <i class="fa-solid fa-image"></i>
                    이미지 삽입 방식
                </h3>
                <div class="iagf-radio-group">
                    <label class="iagf-radio">
                        <input type="radio" name="insert-type" value="disabled" ${insertType === INSERT_TYPE.DISABLED ? 'checked' : ''}>
                        <span class="radio-mark"></span>
                        <span class="radio-label">비활성화</span>
                    </label>
                    <label class="iagf-radio">
                        <input type="radio" name="insert-type" value="inline" ${insertType === INSERT_TYPE.INLINE ? 'checked' : ''}>
                        <span class="radio-mark"></span>
                        <span class="radio-label">현재 메시지에 삽입</span>
                    </label>
                    <label class="iagf-radio">
                        <input type="radio" name="insert-type" value="new" ${insertType === INSERT_TYPE.NEW_MESSAGE ? 'checked' : ''}>
                        <span class="radio-mark"></span>
                        <span class="radio-label">새 메시지로 생성</span>
                    </label>
                </div>
                <p class="section-desc">생성된 이미지를 어디에 삽입할지 선택합니다.</p>
            </div>

            <div class="iagf-section">
                <h3>
                    <i class="fa-solid fa-syringe"></i>
                    프롬프트 인젝션
                </h3>
                <div class="iagf-options-list">
                    <label class="iagf-toggle">
                        <input type="checkbox" id="settings-injection-enabled" ${settings.promptInjection?.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="toggle-label">프롬프트 인젝션 활성화</span>
                    </label>
                </div>
                <div class="field-group">
                    <label>인젝션 프롬프트</label>
                    <textarea id="settings-injection-prompt" class="iagf-textarea" rows="8">${escapeHtmlAttribute(settings.promptInjection?.prompt || '')}</textarea>
                </div>
                <div class="field-group">
                    <label>추출 정규식</label>
                    <input type="text" id="settings-injection-regex" class="iagf-input" 
                        value="${escapeHtmlAttribute(settings.promptInjection?.regex || '')}">
                </div>
            </div>

            <div class="iagf-section">
                <h3>
                    <i class="fa-solid fa-robot"></i>
                    보조 모델
                </h3>
                <div class="iagf-options-list">
                    <label class="iagf-toggle">
                        <input type="checkbox" id="settings-aux-enabled" ${settings.auxiliaryModel?.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                        <span class="toggle-label">보조 모델 사용</span>
                    </label>
                </div>
                <div class="field-group">
                    <label>Connection Profile</label>
                    <div class="select-with-refresh">
                        <select id="settings-aux-profile" class="iagf-select">
                            <option value="">프로필 선택...</option>
                            ${this.renderConnectionProfileOptions(settings.auxiliaryModel?.connectionProfileId)}
                        </select>
                        <button class="iagf-btn" id="btn-refresh-profiles" title="새로고침">
                            <i class="fa-solid fa-rotate"></i>
                        </button>
                    </div>
                </div>
                <p class="section-desc warning">⚠️ Gemini 2.5~3 모델 사용시 종종 검열로 인해 이미지 프롬프트 생성이 실패할 수 있음. 프롬프트를 고치거나 리롤!</p>
            </div>

            <div class="iagf-section">
                <h3>
                    <i class="fa-solid fa-database"></i>
                    데이터 관리
                </h3>
                <div class="settings-actions">
                    <button class="iagf-btn" id="btn-export-settings">
                        <i class="fa-solid fa-download"></i> 설정 내보내기
                    </button>
                    <button class="iagf-btn" id="btn-import-settings">
                        <i class="fa-solid fa-upload"></i> 설정 가져오기
                    </button>
                    <input type="file" id="settings-import-file" accept=".json" style="display:none;">
                    <button class="iagf-btn iagf-btn-danger" id="btn-reset-settings">
                        <i class="fa-solid fa-trash"></i> 설정 초기화
                    </button>
                </div>
            </div>

            <div class="iagf-section">
                <h3>
                    <i class="fa-solid fa-info-circle"></i>
                    정보
                </h3>
                <div class="info-grid">
                    <div class="info-item">
                        <span class="info-label">버전</span>
                        <span class="info-value">1.0.0</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">확장 이름</span>
                        <span class="info-value">${extensionName}</span>
                    </div>
                </div>
            </div>
        </div>`;
    }

    bindPresetsEvents() {
        const $content = this.$modal.find('#iagf-content');

        $content.find('.iagf-preset-item').on('click', (e) => {
            if ($(e.target).closest('.btn-delete-preset').length) return;
            const key = $(e.currentTarget).data('preset-key');
            const scrollTop = $content.find('.iagf-presets-sidebar').scrollTop();
            this.managers.presets?.selectPreset(key);
            this.renderPage('presets');
            this.$modal.find('.iagf-presets-sidebar').scrollTop(scrollTop);
        });

        $content.find('#btn-add-preset').on('click', () => {
            const key = this.managers.presets?.addPreset('New Preset');
            if (key) this.renderPage('presets');
        });

        $content.find('.btn-delete-preset').on('click', (e) => {
            e.stopPropagation();
            const key = $(e.currentTarget).data('preset-key');
            if (confirm('이 프리셋을 삭제하시겠습니까?')) {
                const scrollTop = $content.find('.iagf-presets-sidebar').scrollTop();
                this.managers.presets?.deletePreset(key);
                this.renderPage('presets');
                this.$modal.find('.iagf-presets-sidebar').scrollTop(scrollTop);
            }
        });

        $content.find('#preset-name-input').on('change', (e) => {
            const scrollTop = $content.find('.iagf-presets-sidebar').scrollTop();
            this.managers.presets?.updatePreset(this.settings.currentPreset, { name: e.target.value });
            this.renderPage('presets');
            this.$modal.find('.iagf-presets-sidebar').scrollTop(scrollTop);
        });

        $content.find('#preset-prefix').on('change', (e) => {
            this.managers.presets?.updatePreset(this.settings.currentPreset, { prefixPrompt: e.target.value });
        });

        $content.find('#preset-suffix').on('change', (e) => {
            this.managers.presets?.updatePreset(this.settings.currentPreset, { suffixPrompt: e.target.value });
        });

        $content.find('#preset-negative').on('change', (e) => {
            this.managers.presets?.updatePreset(this.settings.currentPreset, { negativePrompt: e.target.value });
        });

        $content.find('#btn-generate-preview').on('click', async () => {
            await this.generatePresetPreview(this.settings.currentPreset);
        });
    }

    async generatePresetPreview(presetKey) {
        if (!this.generatePreview || this.generatingPreviews.has(presetKey)) return;

        const preset = this.settings.presets[presetKey];
        if (!preset) return;

        this.generatingPreviews.add(presetKey);
        this.renderPage('presets');

        try {
            const prompt = [preset.prefixPrompt, '1girl', preset.suffixPrompt]
                .filter(Boolean)
                .join(', ');
            const negativePrompt = preset.negativePrompt || '';

            const imageData = await this.generatePreview(prompt, negativePrompt);
            
            if (imageData) {
                const base64Image = imageData.startsWith('data:') 
                    ? imageData 
                    : `data:image/png;base64,${imageData}`;
                this.managers.presets?.updatePreset(presetKey, { previewImage: base64Image });
            }
        } catch (error) {
            console.error('[IAGF] Failed to generate preset preview:', error);
        } finally {
            this.generatingPreviews.delete(presetKey);
            this.renderPage('presets');
        }
    }
    bindVibeEvents() {
        const $content = this.$modal.find('#iagf-content');

        $content.find('#vibe-enabled').on('change', (e) => {
            this.managers.vibeTransfer?.setEnabled(e.target.checked);
        });

        $content.find('#btn-add-vibe').on('click', () => {
            $content.find('#vibe-upload').trigger('click');
        });

        $content.find('#vibe-upload').on('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                this.managers.vibeTransfer?.addImage(ev.target.result, file.name);
                this.renderPage('vibe');
            };
            reader.readAsDataURL(file);
        });

        $content.find('.iagf-vibe-item').on('click', (e) => {
            if ($(e.target).closest('button').length) return;
            const id = $(e.currentTarget).data('vibe-id');
            this.managers.vibeTransfer?.selectImage(id);
            this.renderPage('vibe');
        });

        $content.find('.btn-toggle-vibe').on('click', (e) => {
            e.stopPropagation();
            const id = $(e.currentTarget).data('vibe-id');
            this.managers.vibeTransfer?.toggleImageActive(id);
            this.renderPage('vibe');
        });

        $content.find('.btn-delete-vibe').on('click', (e) => {
            e.stopPropagation();
            const id = $(e.currentTarget).data('vibe-id');
            if (confirm('이 이미지를 삭제하시겠습니까?')) {
                this.managers.vibeTransfer?.deleteImage(id);
                this.renderPage('vibe');
            }
        });

        $content.find('#vibe-strength').on('input', (e) => {
            const value = parseFloat(e.target.value);
            $content.find('#vibe-strength-value').text(value);
            this.managers.vibeTransfer?.setStrength(value);
        });

        $content.find('#vibe-info-extracted').on('input', (e) => {
            const value = parseFloat(e.target.value);
            $content.find('#vibe-info-value').text(value);
            this.managers.vibeTransfer?.setInfoExtracted(value);
        });
    }
    bindCharRefEvents() {
        const $content = this.$modal.find('#iagf-content');

        $content.find('#charref-enabled').on('change', (e) => {
            this.settings.characterReference.enabled = e.target.checked;
            this.saveSettings();
        });

        $content.find('#btn-add-char').on('click', () => {
            const name = $content.find('#new-char-name').val()?.trim();
            if (name) {
                this.managers.characterRef?.addCharacter(name);
                this.managers.characterRef?.activateCharacter(name);
                this.renderPage('charref');
            }
        });

        $content.find('.iagf-char-item').on('click', (e) => {
            if ($(e.target).closest('button').length || $(e.target).closest('.iagf-toggle').length) return;
            const name = $(e.currentTarget).data('char-name');
            this.managers.characterRef?.activateCharacter(name);
            this.renderPage('charref');
        });

        $content.find('.char-enabled-toggle').on('change', (e) => {
            e.stopPropagation();
            const name = $(e.currentTarget).data('char-name');
            this.managers.characterRef?.toggleCharacterEnabled(name);
            this.renderPage('charref');
        });

        $content.find('.btn-delete-char').on('click', (e) => {
            e.stopPropagation();
            const name = $(e.currentTarget).data('char-name');
            if (confirm(`"${name}" 캐릭터를 삭제하시겠습니까?`)) {
                this.managers.characterRef?.deleteCharacter(name);
                this.renderPage('charref');
            }
        });

        $content.find('#btn-add-char-image').on('click', () => {
            $content.find('#char-image-upload').trigger('click');
        });

        $content.find('#char-image-upload').on('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const botData = this.managers.characterRef?.getBotData();
            const activeChar = botData?.activeCharacter;
            if (!activeChar) return;

            const reader = new FileReader();
            reader.onload = (ev) => {
                this.managers.characterRef?.addImageToCharacter(activeChar, ev.target.result, file.name);
                this.renderPage('charref');
            };
            reader.readAsDataURL(file);
        });

        $content.find('.iagf-char-image').on('click', (e) => {
            if ($(e.target).closest('button').length || $(e.target).closest('.iagf-toggle').length) return;
            const imageId = $(e.currentTarget).data('image-id');
            const charName = $(e.currentTarget).data('char-name');
            this.managers.characterRef?.selectImage(charName, imageId);
            this.renderPage('charref');
        });

        $content.find('.image-enabled-toggle').on('change', (e) => {
            e.stopPropagation();
            const imageId = $(e.currentTarget).data('image-id');
            const botData = this.managers.characterRef?.getBotData();
            const activeChar = botData?.activeCharacter;
            if (activeChar) {
                this.managers.characterRef?.toggleImageEnabled(activeChar, imageId);
                this.renderPage('charref');
            }
        });

        $content.find('.btn-delete-char-image').on('click', (e) => {
            e.stopPropagation();
            const imageId = $(e.currentTarget).data('image-id');
            const botData = this.managers.characterRef?.getBotData();
            const activeChar = botData?.activeCharacter;
            if (activeChar && confirm('이 이미지를 삭제하시겠습니까?')) {
                this.managers.characterRef?.deleteImage(activeChar, imageId);
                this.renderPage('charref');
            }
        });

        $content.find('#charref-fidelity').on('input', (e) => {
            const value = parseFloat(e.target.value);
            $content.find('#charref-fidelity-value').text(value);
            const botData = this.managers.characterRef?.getBotData();
            if (botData?.activeCharacter) {
                this.managers.characterRef?.setFidelity(botData.activeCharacter, value);
            }
        });

        $content.find('#charref-style-aware').on('change', (e) => {
            const botData = this.managers.characterRef?.getBotData();
            if (botData?.activeCharacter) {
                this.managers.characterRef?.setStyleAware(botData.activeCharacter, e.target.checked);
            }
        });
    }
    bindCharPromptsEvents() {
        const $content = this.$modal.find('#iagf-content');

        $content.find('#charprompts-enabled').on('change', (e) => {
            this.settings.characterPrompts.enabled = e.target.checked;
            this.saveSettings();
        });

        $content.find('#charprompts-position').on('change', (e) => {
            this.settings.characterPrompts.positionEnabled = e.target.checked;
            this.saveSettings();
        });

        $content.find('#btn-add-charprompt').on('click', () => {
            this.managers.characterPrompts?.addCharacterPrompt();
            this.renderPage('charprompts');
        });

        $content.find('.btn-delete-charprompt').on('click', (e) => {
            const id = $(e.currentTarget).data('char-id');
            if (confirm('이 캐릭터 프롬프트를 삭제하시겠습니까?')) {
                this.managers.characterPrompts?.deleteCharacterPrompt(id);
                this.renderPage('charprompts');
            }
        });

        $content.find('.charprompt-toggle').on('change', (e) => {
            const id = $(e.currentTarget).data('char-id');
            this.managers.characterPrompts?.toggleCharacterPrompt(id);
        });

        $content.find('.charprompt-name').on('change', (e) => {
            const id = $(e.currentTarget).data('char-id');
            this.managers.characterPrompts?.updateCharacterPrompt(id, { name: e.target.value });
        });

        $content.find('.charprompt-prompt').on('change', (e) => {
            const id = $(e.currentTarget).data('char-id');
            this.managers.characterPrompts?.updateCharacterPrompt(id, { prompt: e.target.value });
        });

        $content.find('.charprompt-negative').on('change', (e) => {
            const id = $(e.currentTarget).data('char-id');
            this.managers.characterPrompts?.updateCharacterPrompt(id, { negative: e.target.value });
        });
    }
    bindTagsEvents() {
        const $content = this.$modal.find('#iagf-content');

        $content.find('#tags-enabled').on('change', async (e) => {
            await this.managers.tagMatching?.setEnabled(e.target.checked);
            this.renderPage('tags');
        });

        $content.find('#tags-fuzzy-best').on('change', (e) => {
            this.managers.tagMatching?.setUseFuzzyBest(e.target.checked);
        });

        $content.find('#tags-keep-unmatched').on('change', (e) => {
            this.managers.tagMatching?.setKeepUnmatched(e.target.checked);
        });

        $content.find('#tags-show-stats').on('change', (e) => {
            this.managers.tagMatching?.setShowStats(e.target.checked);
        });
    }
    bindSettingsEvents() {
        const $content = this.$modal.find('#iagf-content');

        $content.find('input[name="insert-type"]').on('change', (e) => {
            this.settings.insertType = e.target.value;
            this.saveSettings();
            this.onUpdate('insertType');
        });

        $content.find('#settings-injection-enabled').on('change', (e) => {
            this.settings.promptInjection.enabled = e.target.checked;
            this.saveSettings();
        });

        $content.find('#settings-injection-prompt').on('change', (e) => {
            this.settings.promptInjection.prompt = e.target.value;
            this.saveSettings();
        });

        $content.find('#settings-injection-regex').on('change', (e) => {
            this.settings.promptInjection.regex = e.target.value;
            this.saveSettings();
        });

        $content.find('#settings-aux-enabled').on('change', (e) => {
            this.settings.auxiliaryModel.enabled = e.target.checked;
            this.saveSettings();
        });

        $content.find('#settings-aux-profile').on('change', (e) => {
            this.settings.auxiliaryModel.connectionProfileId = e.target.value;
            this.saveSettings();
        });

        $content.find('#btn-refresh-profiles').on('click', () => {
            const $select = $content.find('#settings-aux-profile');
            const currentValue = $select.val();
            $select.html(`
                <option value="">프로필 선택...</option>
                ${this.renderConnectionProfileOptions(currentValue)}
            `);
            $select.val(currentValue);
        });

        $content.find('#btn-export-settings').on('click', () => {
            const data = JSON.stringify(this.settings, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'iagf-settings.json';
            a.click();
            URL.revokeObjectURL(url);
        });

        $content.find('#btn-import-settings').on('click', () => {
            $content.find('#settings-import-file').trigger('click');
        });

        $content.find('#settings-import-file').on('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const imported = JSON.parse(ev.target.result);
                    Object.assign(this.settings, imported);
                    this.saveSettings();
                    this.renderPage('settings');
                    alert('설정을 가져왔습니다.');
                } catch (err) {
                    alert('설정 파일을 읽는 중 오류가 발생했습니다.');
                }
            };
            reader.readAsText(file);
        });

        $content.find('#btn-reset-settings').on('click', () => {
            if (confirm('모든 설정을 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
                this.onUpdate('reset');
                this.renderPage('settings');
            }
        });
    }

    updateStatusBadge(status, text) {
        const $badge = this.$modal.find('#iagf-status-badge');
        $badge.removeClass('ready generating error').addClass(status);
        $badge.find('.status-text').text(text);
    }
}
