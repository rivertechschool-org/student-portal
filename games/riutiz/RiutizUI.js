// games/riutiz/RiutizUI.js
// UI rendering for RIUTIZ card game

class RiutizUI {
    constructor(game, options = {}) {
        this.game = game;
        this.localPlayer = options.localPlayer || 1; // Which player we're viewing as
        this.onCardClick = options.onCardClick || (() => {});
        this.onCardLongPress = options.onCardLongPress || (() => {});
        this.onConcede = options.onConcede || null;   // online matches: forfeit

        this.longPressTimer = null;
        this.didLongPress = false;
        this.selectedCard = null;
        this.selectedFieldCard = null;

        // Ability targeting state
        this.action = null;          // a card or ability gathering its targets
        this.pickingMode = null;
        this.selectedBlocker = null;

        // Drag and drop state
        this.draggedCard = null;
        this.dragElement = null;
        this.dragStartPos = { x: 0, y: 0 };
        this.isDragging = false;
        this.isTouchDevice = false;

        // Hover preview state
        this.hoverPreviewElement = null;
        this.hoverPreviewTimeout = null;

        // Element references
        this.elements = {};
    }

    /**
     * Initialize UI with DOM element references
     */
    init(elementIds) {
        const ids = {
            gameScreen: 'game-screen',
            menuScreen: 'menu-screen',
            victoryScreen: 'victory-screen',
            previewOverlay: 'preview-overlay',
            oppPoints: 'opp-points',
            yourPoints: 'your-points',
            oppHandCount: 'opp-hand-count',
            oppDeckCount: 'opp-deck-count',
            yourHandCount: 'your-hand-count',
            yourDeckCount: 'your-deck-count',
            turnNumber: 'turn-number',
            turnIndicator: 'turn-indicator',
            fieldHint: 'field-hint',
            oppResources: 'opp-resources',
            oppField: 'opp-field',
            oppArtifacts: 'opp-artifacts',
            yourResources: 'your-resources',
            yourField: 'your-field',
            yourArtifacts: 'your-artifacts',
            centerLocation: 'center-location',
            yourHand: 'your-hand',
            actionButtons: 'action-buttons',
            message: 'message',
            winnerText: 'winner-text',
            finalScore: 'final-score',
            ...elementIds
        };

        for (const [key, id] of Object.entries(ids)) {
            this.elements[key] = document.getElementById(id);
        }

        // Detect touch device
        this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        // Create hover preview element for PC
        if (!this.isTouchDevice) {
            this.createHoverPreviewElement();
        }

        // Set up drop zones
        this.setupDropZones();
    }

    /**
     * Keyword definitions for tooltips
     */
    static get KEYWORD_TOOLTIPS() {
        return {
            'impulsive': 'Can attack the turn it enters the field',
            'relentless': 'Can attack even while spent',
            'grounded': 'Cannot attack, but can still block',
            'lethal': 'Any damage defeats the target regardless of Endurance',
            'stubborn': 'Cannot be exhausted by damage - it stays at 1',
            'non-sequitur': 'Each roll flips a coin: heads doubles it, tails makes it 0',
            'overwhelm': 'Excess damage beyond blocker\'s Endurance scores as points',
            'interject': 'Triggers an effect when entering the battlefield',
            'lockdown': 'Target cannot attack or block',
            'closed-minded': "Ignores its own side's buffs and cannot gain abilities",
            'overwhelm ': '',
            'rebuttal': 'When it takes damage while blocking, it hits the attacker back',
            'lethal:': ''
        };
    }

    /**
     * Highlight keywords in ability text with styled tooltips
     */
    highlightKeywords(abilityText) {
        if (!abilityText) return '';
        let result = abilityText;
        for (const [keyword, tooltip] of Object.entries(RiutizUI.KEYWORD_TOOLTIPS)) {
            const regex = new RegExp(`\\b(${keyword})\\b`, 'gi');
            result = result.replace(regex, `<span class="keyword-highlight" title="${tooltip}">$1</span>`);
        }
        return result;
    }

    /**
     * Create hover preview element
     */
    createHoverPreviewElement() {
        if (this.hoverPreviewElement) return;

        // One per page, not one per game: every rematch used to append another
        const existing = document.getElementById('game-hover-preview');
        if (existing) {
            this.hoverPreviewElement = existing;
            return;
        }

        this.hoverPreviewElement = document.createElement('div');
        this.hoverPreviewElement.id = 'game-hover-preview';
        this.hoverPreviewElement.style.cssText = `
            position: fixed;
            z-index: 1000;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.15s;
            display: none;
        `;
        document.body.appendChild(this.hoverPreviewElement);
    }

    /**
     * Set up drop zones for drag and drop
     */
    setupDropZones() {
        // The drop zones are static nodes that outlive the game: bind once
        if (this.elements.yourField && this.elements.yourField.dataset.dropZonesBound) return;
        if (this.elements.yourField) this.elements.yourField.dataset.dropZonesBound = '1';

        // Field drop zone
        if (this.elements.yourField) {
            this.elements.yourField.addEventListener('dragover', (e) => this.handleDragOver(e, 'field'));
            this.elements.yourField.addEventListener('drop', (e) => this.handleDrop(e, 'field'));
            this.elements.yourField.addEventListener('dragleave', (e) => this.handleDragLeave(e, 'field'));
        }

        // Resource drop zone - add listeners to both row and the yours area for easier targeting
        if (this.elements.yourResources) {
            this.elements.yourResources.addEventListener('dragover', (e) => this.handleDragOver(e, 'resource'));
            this.elements.yourResources.addEventListener('drop', (e) => this.handleDrop(e, 'resource'));
            this.elements.yourResources.addEventListener('dragleave', (e) => this.handleDragLeave(e, 'resource'));

            // Also add to parent resources-area for easier drop targeting
            const resourcesArea = this.elements.yourResources.closest('.resources-area');
            if (resourcesArea) {
                resourcesArea.addEventListener('dragover', (e) => this.handleDragOver(e, 'resource'));
                resourcesArea.addEventListener('drop', (e) => {
                    e.preventDefault();
                    this.handleDrop({ preventDefault: () => {}, currentTarget: this.elements.yourResources }, 'resource');
                });
                resourcesArea.addEventListener('dragleave', (e) => this.handleDragLeave(e, 'resource'));
            }
        }
    }

    /**
     * Get color data
     */
    getColor(colorCode) {
        return RiutizGame.COLORS[colorCode] || RiutizGame.COLORS.C;
    }



    /**
     * Update battlefield background based on active location
     */
    updateBattlefieldBackground(allFieldCards) {
        const battlefield = document.querySelector('.battlefield');
        if (!battlefield) return;

        // Find the most recently played location (last location in the combined field)
        const locations = allFieldCards.filter(card => card.type === 'Location');
        const activeLocation = locations.length > 0 ? locations[locations.length - 1] : null;

        // Location class map
        const locationClasses = {
            'Parking Lot': 'loc-parking-lot',
            'The Workshop': 'loc-workshop',
            'Field': 'loc-field',
            'Gym/Weights Room': 'loc-gym',
            'Cafeteria': 'loc-cafeteria',
            'The Lab': 'loc-lab',
            'Music Room': 'loc-music-room',
            'The Amphitheater': 'loc-amphitheater',
            'The Counselor\'s Office': 'loc-counselor',
            'Auditorium': 'loc-auditorium',
            'The Office': 'loc-office',
            'The Computer Lab': 'loc-computer-lab',
            'Server Room': 'loc-server-room',
            'Library': 'loc-library',
            'Playground': 'loc-playground',
            'University': 'loc-university'
        };

        // Get current and new location class
        const currentLocClass = Array.from(battlefield.classList).find(c => c.startsWith('loc-'));
        const newLocClass = activeLocation ? locationClasses[activeLocation.name] : null;

        // Only animate if location changed
        if (currentLocClass !== newLocClass) {
            // Remove all location classes
            battlefield.className = battlefield.className
                .split(' ')
                .filter(c => !c.startsWith('loc-'))
                .join(' ');

            // Animate the transition
            battlefield.classList.add('location-changing');

            setTimeout(() => {
                battlefield.classList.remove('location-changing');
                if (newLocClass) {
                    battlefield.classList.add(newLocClass);
                }
            }, 150);
        }
    }



















    /**
     * Render hand - fanned arc layout like MTG Arena
     */
    renderHand(container, hand) {
        container.innerHTML = '';

        const cardCount = hand.length;
        if (cardCount === 0) return;

        // Calculate fan parameters. The spread is also capped by the width we
        // actually have: on a phone a 7-card hand spread to 31.5rem and the two
        // outer cards sat off the screen, unreachable.
        const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const availRem = (container.clientWidth || window.innerWidth) / remPx;
        const cardWidth = 6; // .card.in-hand is 6rem wide
        const maxSpread = Math.max(0, Math.min(cardCount * 4.5, 40, availRem - cardWidth - 1)); // rem
        const maxRotation = Math.min(cardCount * 3, 25); // Max rotation in degrees

        hand.forEach((card, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'hand-card-wrapper';

            const isSelected = this.selectedCard?.instanceId === card.instanceId;

            // Calculate position in the fan
            const progress = cardCount === 1 ? 0.5 : index / (cardCount - 1);
            const centeredProgress = progress - 0.5; // -0.5 to 0.5

            // Calculate horizontal offset from center
            const xOffset = centeredProgress * maxSpread;

            // Calculate rotation (cards at edges rotate more)
            const rotation = centeredProgress * maxRotation;

            // Calculate vertical offset (arc shape - edges lower)
            const yOffset = Math.abs(centeredProgress) * 1.5; // rem

            // Z-index: center cards on top when fanned, but hovered card always on top
            const zIndex = Math.round((1 - Math.abs(centeredProgress)) * 10) + 1;

            wrapper.style.cssText = `
                left: calc(50% + ${xOffset}rem - ${cardWidth / 2}rem);
                transform: rotate(${rotation}deg) translateY(${yOffset}rem);
                z-index: ${isSelected ? 50 : zIndex};
            `;

            if (isSelected) {
                wrapper.style.transform = `rotate(0deg) translateY(-1.5rem) scale(1.1)`;
                wrapper.style.zIndex = '50';
            }

            const el = this.renderCard(card, {
                inHand: true,
                selected: isSelected,
                onClick: () => this.handleHandCardClick(card)
            });

            wrapper.appendChild(el);
            container.appendChild(wrapper);
        });
    }

    /**
     * Render a single card
     */
    renderCard(card, options = {}) {
        const { small, inHand, selected, attacker, blocker, targetable, spent, onClick } = options;
        const color = this.game.getPrimaryColor(card.cost);
        const c = this.getColor(color);
        const isPupil = card.type?.includes('Pupil');
        // A card in play with an ability its controller can use right now
        const hasSpendAbility = !inHand && !small ? false
            : (!inHand && this.game.state && this.game.findInPlay(card.instanceId)
               && this.game.controllerOf(card) === this.localPlayer && this.usableAbilities(card).length > 0);

        let classes = 'card';
        if (small) classes += ' small';
        else if (inHand) classes += ' in-hand';
        if (selected) classes += ' selected';
        if (attacker) classes += ' attacker';
        if (blocker) classes += ' blocker';
        if (targetable) classes += ' targetable';
        if (spent) classes += ' spent';

        // Build cost HTML
        const cost = this.game.parseCost(card.cost);
        let costHtml = '';
        if (cost.generic > 0) {
            costHtml += `<div class="mana-pip generic">${cost.generic}</div>`;
        }
        for (const [col, count] of Object.entries(cost.colors)) {
            for (let i = 0; i < count; i++) {
                const colData = this.getColor(col);
                costHtml += `<div class="mana-pip" style="background: ${colData.hex}">${col}</div>`;
            }
        }

        const icon = isPupil ? '👤' : card.type === 'Interruption' ? '⚡' : card.type === 'Tool' ? '🔧' : '🏛️';

        let indicatorHtml = '';
        if (card.hasGettingBearings && isPupil) {
            indicatorHtml = '<div class="card-indicator indicator-bearings">💫</div>';
        } else if (hasSpendAbility && !card.isSpent) {
            indicatorHtml = '<div class="card-indicator indicator-activate">⚡</div>';
        }

        const div = document.createElement('div');
        div.className = classes;
        div.style.cssText = `background: linear-gradient(135deg, ${c.bg} 0%, #0a0a0a 100%); border: 2px solid ${c.hex}; box-shadow: 0 0 10px ${c.hex}40;`;

        // Make hand cards draggable
        if (inHand) {
            div.draggable = true;
            div.dataset.cardId = card.instanceId;
        }

        div.innerHTML = `
            ${indicatorHtml}
            <div class="card-inner">
                <div class="card-header">
                    <div class="card-name" style="color: ${c.hex}">${card.name}</div>
                    <div class="card-cost">${costHtml}</div>
                </div>
                <div class="card-type">${card.type}${card.subTypes ? ' — ' + card.subTypes : ''}</div>
                <div class="card-art" style="background: linear-gradient(180deg, ${c.hex}20 0%, ${c.bg} 100%); border: 1px solid ${c.hex}40;">${icon}</div>
                ${isPupil ? `<div class="card-stats"><span class="stat-dice">🎲 ${card.diceNow || card.dice}${card.dieRollBonus ? ` ${card.dieRollBonus > 0 ? '+' : ''}${card.dieRollBonus}` : ''}</span><span class="stat-hp">❤️ ${card.currentEndurance ?? card.endurance}${card.damageReductionTotal ? ` 🛡${card.damageReductionTotal}` : ''}${card.counters?.shield ? ` ◈${card.counters.shield}` : ''}</span></div>` : ''}
                ${card.ability ? `<div class="card-ability">${this.highlightKeywords(card.ability)}</div>` : ''}
            </div>
            <div class="card-rarity ${card.rarity || 'C'}"></div>
        `;

        // --- PC: Hover preview ---
        if (!this.isTouchDevice) {
            div.addEventListener('mouseenter', (e) => {
                this.showHoverPreview(card, e);
            });
            div.addEventListener('mouseleave', () => {
                this.hideHoverPreview();
            });
            div.addEventListener('mousemove', (e) => {
                this.updateHoverPreviewPosition(e);
            });
        }

        // --- Mobile: Long press preview ---
        if (this.isTouchDevice) {
            let touchMoved = false;

            div.addEventListener('touchstart', (e) => {
                touchMoved = false;
                this.didLongPress = false;

                this.longPressTimer = setTimeout(() => {
                    if (!touchMoved) {
                        this.didLongPress = true;
                        this.showPreview(card);
                    }
                }, 400);
            }, { passive: true });

            div.addEventListener('touchmove', () => {
                touchMoved = true;
                if (this.longPressTimer) {
                    clearTimeout(this.longPressTimer);
                    this.longPressTimer = null;
                }
            }, { passive: true });

            div.addEventListener('touchend', () => {
                if (this.longPressTimer) {
                    clearTimeout(this.longPressTimer);
                    this.longPressTimer = null;
                }
                // Keep preview open until tapped elsewhere
            });

            div.addEventListener('touchcancel', () => {
                if (this.longPressTimer) {
                    clearTimeout(this.longPressTimer);
                    this.longPressTimer = null;
                }
            });
        }

        // --- Drag and drop for hand cards ---
        if (inHand) {
            div.addEventListener('dragstart', (e) => {
                this.handleDragStart(e, card);
            });
            div.addEventListener('dragend', (e) => {
                this.handleDragEnd(e);
            });

            // Touch drag for mobile
            if (this.isTouchDevice) {
                this.setupTouchDrag(div, card);
            }
        }

        // Click handler
        div.addEventListener('click', (e) => {
            if (!this.didLongPress && !this.isDragging && onClick) {
                onClick();
            }
            this.didLongPress = false;
        });

        div.addEventListener('contextmenu', (e) => e.preventDefault());

        return div;
    }

    /**
     * Show hover preview (PC only)
     */
    showHoverPreview(card, event) {
        if (this.isTouchDevice || !this.hoverPreviewElement) return;

        const color = this.game.getPrimaryColor(card.cost);
        const c = this.getColor(color);
        const isPupil = card.type?.includes('Pupil');
        const cost = this.game.parseCost(card.cost);

        let costHtml = '';
        if (cost.generic > 0) {
            costHtml += `<div class="mana-pip generic" style="width:1.5rem;height:1.5rem;font-size:0.8rem;">${cost.generic}</div>`;
        }
        for (const [col, count] of Object.entries(cost.colors)) {
            for (let i = 0; i < count; i++) {
                const colData = this.getColor(col);
                costHtml += `<div class="mana-pip" style="background:${colData.hex};width:1.5rem;height:1.5rem;font-size:0.8rem;">${col}</div>`;
            }
        }

        const icon = isPupil ? '👤' : card.type === 'Interruption' ? '⚡' : card.type === 'Tool' ? '🔧' : '🏛️';
        const rarityText = card.rarity === 'R' ? '★ Rare' : card.rarity === 'U' ? '◆ Uncommon' : '○ Common';

        this.hoverPreviewElement.innerHTML = `
            <div style="background: linear-gradient(135deg, ${c.bg} 0%, #0a0a0a 100%);
                        border: 2px solid ${c.hex}; border-radius: 0.75rem;
                        box-shadow: 0 10px 40px rgba(0,0,0,0.6); width: 14rem; padding: 0.75rem;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.25rem;">
                    <span style="font-size: 1rem; font-weight: bold; color: ${c.hex};">${card.name}</span>
                    <div style="display: flex; gap: 0.15rem;">${costHtml}</div>
                </div>
                <div style="color: #a1a1aa; font-size: 0.7rem; margin-bottom: 0.5rem;">${card.type}${card.subTypes ? ' — ' + card.subTypes : ''}</div>
                <div style="height: 4rem; display: flex; align-items: center; justify-content: center;
                            font-size: 2rem; opacity: 0.6; background: ${c.bg}; border-radius: 0.25rem; margin-bottom: 0.5rem;">${icon}</div>
                ${isPupil ? `<div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 0.5rem;">
                    <span style="color: #fbbf24;" title="Attack dice - an unblocked pupil scores its roll">🎲 ${card.diceNow || card.dice}${card.dieRollBonus ? ` ${card.dieRollBonus > 0 ? '+' : ''}${card.dieRollBonus}` : ''}</span>
                    <span style="color: #ef4444;" title="Endurance (health)">❤️ ${card.currentEndurance ?? card.endurance}</span>
                </div>` : ''}
                <div style="font-size: 0.75rem; color: #e4e4e7; line-height: 1.4; min-height: 2rem;">
                    ${card.ability ? this.highlightKeywords(card.ability) : '<span style="color:#71717a;font-style:italic;">No ability</span>'}
                </div>
                <div style="font-size: 0.65rem; color: #71717a; margin-top: 0.5rem; border-top: 1px solid ${c.hex}40; padding-top: 0.25rem;">
                    ${rarityText}
                </div>
            </div>
        `;

        this.updateHoverPreviewPosition(event);
        this.hoverPreviewElement.style.display = 'block';
        this.hoverPreviewElement.style.opacity = '1';
    }

    /**
     * Update hover preview position
     */
    updateHoverPreviewPosition(event) {
        if (!this.hoverPreviewElement) return;

        const previewWidth = 224;
        const previewHeight = 280;
        let left = event.clientX + 15;
        let top = event.clientY - 20;

        // Adjust if going off right edge
        if (left + previewWidth > window.innerWidth - 10) {
            left = event.clientX - previewWidth - 15;
        }

        // Adjust if going off bottom
        if (top + previewHeight > window.innerHeight - 10) {
            top = window.innerHeight - previewHeight - 10;
        }

        // Adjust if going off top
        if (top < 10) top = 10;

        this.hoverPreviewElement.style.left = left + 'px';
        this.hoverPreviewElement.style.top = top + 'px';
    }

    /**
     * Hide hover preview
     */
    hideHoverPreview() {
        if (this.hoverPreviewElement) {
            this.hoverPreviewElement.style.opacity = '0';
            setTimeout(() => {
                if (this.hoverPreviewElement && this.hoverPreviewElement.style.opacity === '0') {
                    this.hoverPreviewElement.style.display = 'none';
                }
            }, 150);
        }
    }

    /**
     * Handle drag start
     */
    handleDragStart(e, card) {
        this.draggedCard = card;
        this.isDragging = true;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.instanceId);

        // Add dragging style
        e.target.style.opacity = '0.5';

        // Highlight drop zones
        this.highlightDropZones(true);
    }

    /**
     * Handle drag end
     */
    handleDragEnd(e) {
        e.target.style.opacity = '1';
        this.isDragging = false;
        this.draggedCard = null;
        this.highlightDropZones(false);

        setTimeout(() => {
            this.isDragging = false;
        }, 100);
    }

    /**
     * Handle drag over
     */
    handleDragOver(e, zone) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        // Add hover effect
        e.currentTarget.style.background = zone === 'field'
            ? 'rgba(34, 197, 94, 0.2)'
            : 'rgba(59, 130, 246, 0.2)';
        e.currentTarget.style.borderColor = zone === 'field' ? '#22c55e' : '#3b82f6';
    }

    /**
     * Handle drag leave
     */
    handleDragLeave(e, zone) {
        e.currentTarget.style.background = '';
        e.currentTarget.style.borderColor = '';
    }



    /**
     * Highlight drop zones during drag
     */
    highlightDropZones(show) {
        const fieldZone = this.elements.yourField;
        const resourceZone = this.elements.yourResources;
        const resourcesArea = resourceZone?.closest('.resources-area');

        if (show) {
            if (fieldZone) {
                fieldZone.style.outline = '2px dashed #22c55e';
                fieldZone.style.outlineOffset = '-2px';
                fieldZone.style.background = 'rgba(34, 197, 94, 0.1)';
            }
            // Highlight the entire resources area for better visibility
            if (resourcesArea) {
                resourcesArea.style.outline = '2px dashed #3b82f6';
                resourcesArea.style.outlineOffset = '2px';
                resourcesArea.style.background = 'rgba(59, 130, 246, 0.15)';
                resourcesArea.style.borderRadius = '0.5rem';
                resourcesArea.style.padding = '0.25rem';
            }
        } else {
            if (fieldZone) {
                fieldZone.style.outline = '';
                fieldZone.style.background = '';
                fieldZone.style.outlineOffset = '';
            }
            if (resourcesArea) {
                resourcesArea.style.outline = '';
                resourcesArea.style.outlineOffset = '';
                resourcesArea.style.background = '';
                resourcesArea.style.borderRadius = '';
                resourcesArea.style.padding = '';
            }
        }
    }

    /**
     * Setup touch drag for mobile
     */
    setupTouchDrag(element, card) {
        let dragClone = null;
        let startX, startY;
        let isDragActive = false;

        element.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, { passive: true });

        element.addEventListener('touchmove', (e) => {
            if (this.didLongPress) return; // Don't drag during long press preview

            const deltaX = Math.abs(e.touches[0].clientX - startX);
            const deltaY = Math.abs(e.touches[0].clientY - startY);

            // Start drag if moved enough
            if (!isDragActive && (deltaX > 20 || deltaY > 20)) {
                isDragActive = true;
                this.isDragging = true;
                this.draggedCard = card;

                // Clear long press timer
                if (this.longPressTimer) {
                    clearTimeout(this.longPressTimer);
                    this.longPressTimer = null;
                }

                // Create drag clone
                dragClone = element.cloneNode(true);
                dragClone.style.cssText = `
                    position: fixed;
                    pointer-events: none;
                    z-index: 1000;
                    opacity: 0.8;
                    transform: scale(1.1) rotate(5deg);
                    transition: none;
                `;
                document.body.appendChild(dragClone);

                element.style.opacity = '0.3';
                this.highlightDropZones(true);
            }

            if (isDragActive && dragClone) {
                e.preventDefault();
                dragClone.style.left = (e.touches[0].clientX - 50) + 'px';
                dragClone.style.top = (e.touches[0].clientY - 70) + 'px';
            }
        }, { passive: false });

        element.addEventListener('touchend', (e) => {
            if (isDragActive && dragClone) {
                const touch = e.changedTouches[0];
                const dropTarget = document.elementFromPoint(touch.clientX, touch.clientY);

                // Check if dropped on field
                const fieldZone = this.elements.yourField;
                const resourceZone = this.elements.yourResources;
                const resourceContainer = document.querySelector('.resources-container');

                if (fieldZone?.contains(dropTarget) || fieldZone?.parentElement?.contains(dropTarget)) {
                    this.handleDrop({ preventDefault: () => {}, currentTarget: fieldZone }, 'field');
                }
                // Check if dropped on resources (check container too for easier drop target)
                else if (resourceZone?.contains(dropTarget) ||
                         resourceContainer?.contains(dropTarget) ||
                         dropTarget?.closest('.resources-area.yours')) {
                    this.handleDrop({ preventDefault: () => {}, currentTarget: resourceZone }, 'resource');
                }

                dragClone.remove();
                element.style.opacity = '1';
                this.highlightDropZones(false);
            }

            isDragActive = false;
            this.isDragging = false;
            this.draggedCard = null;
        });
    }

    /**
     * Show card preview overlay
     */
    showPreview(card) {
        const color = this.game.getPrimaryColor(card.cost);
        const c = this.getColor(color);
        const isPupil = card.type?.includes('Pupil');
        const cost = this.game.parseCost(card.cost);

        let costHtml = '';
        if (cost.generic > 0) {
            costHtml += `<div class="mana-pip generic">${cost.generic}</div>`;
        }
        for (const [col, count] of Object.entries(cost.colors)) {
            for (let i = 0; i < count; i++) {
                const colData = this.getColor(col);
                costHtml += `<div class="mana-pip" style="background: ${colData.hex}">${col}</div>`;
            }
        }

        const icon = isPupil ? '👤' : card.type === 'Interruption' ? '⚡' : card.type === 'Tool' ? '🔧' : '🏛️';
        const rarityText = card.rarity === 'R' ? '★ Rare' : card.rarity === 'U' ? '◆ Uncommon' : '○ Common';

        this.elements.previewOverlay.innerHTML = `
            <div class="preview-card" style="background: linear-gradient(135deg, ${c.bg} 0%, #0a0a0a 100%); box-shadow: 0 0 60px ${c.hex}60; border: 3px solid ${c.hex};">
                <div class="preview-header">
                    <div class="preview-name-row">
                        <div class="preview-name" style="color: ${c.hex}">${card.name}</div>
                        <div class="preview-cost">${costHtml}</div>
                    </div>
                    <div class="preview-type">${card.type}${card.subTypes ? ' — ' + card.subTypes : ''}</div>
                </div>
                <div class="preview-art" style="background: linear-gradient(180deg, ${c.hex}30 0%, ${c.bg} 100%); border: 1px solid ${c.hex}50;">${icon}</div>
                ${isPupil ? `<div class="preview-stats"><span style="color: #fbbf24">🎲 ${card.diceNow || card.dice}${card.dieRollBonus ? ` ${card.dieRollBonus > 0 ? '+' : ''}${card.dieRollBonus}` : ''}</span><span style="color: #ef4444">❤️ ${card.currentEndurance ?? card.endurance}</span></div>` : ''}
                <div class="preview-ability">
                    ${card.ability ? `<p>${this.highlightKeywords(card.ability)}</p>` : '<p class="no-ability">No ability text.</p>'}
                </div>
                ${card.resourceAbility ? `<div class="preview-resource"><p><span>Resource:</span> ${card.resourceAbility}</p></div>` : ''}
                <div class="preview-footer">
                    <span class="preview-rarity">${rarityText}</span>
                    <div class="card-rarity ${card.rarity || 'C'}" style="width: 1rem; height: 1rem;"></div>
                </div>
                <div class="preview-hint">Tap anywhere to close</div>
            </div>
        `;
        this.elements.previewOverlay.classList.remove('hidden');

        // Allow tap to close on mobile
        this.elements.previewOverlay.onclick = () => {
            this.hidePreview();
        };

        this.onCardLongPress(card);
    }

    /**
     * Hide card preview
     */
    hidePreview() {
        this.elements.previewOverlay.classList.add('hidden');
    }







    /**
     * Render full game state
     */
    render() {
        const state = this.game.state;
        if (!state) return;

        const isYourTurn = state.currentPlayer === this.localPlayer;
        const you = state.players[this.localPlayer];
        const opp = state.players[this.localPlayer === 1 ? 2 : 1];

        this.elements.oppPoints.textContent = opp.points + ' pts';
        this.elements.yourPoints.textContent = you.points + ' pts';
        this.elements.oppHandCount.textContent = opp.hand.length;
        this.elements.oppDeckCount.textContent = opp.deck.length;
        this.elements.yourHandCount.textContent = you.hand.length;
        this.elements.yourDeckCount.textContent = you.deck.length;
        this.elements.turnNumber.textContent = state.turn;

        document.querySelectorAll('.phase').forEach(el => {
            el.classList.toggle('active', el.dataset.phase === (state.combatStep ? 'combat' : state.phase));
        });

        this.elements.turnIndicator.textContent = isYourTurn ? 'Your Turn' : "Opponent's Turn";
        this.elements.turnIndicator.className = 'turn-indicator ' + (isYourTurn ? 'your-turn' : 'opp-turn');
        if (this.elements.fieldHint) this.elements.fieldHint.textContent = '';

        // An action in progress that is no longer possible (the state moved on) is dropped
        if (this.action && !this.actionStillValid()) this.action = null;

        this.renderResources(this.elements.oppResources, opp.resources, false);
        this.renderResources(this.elements.yourResources, you.resources, true);

        const allFieldCards = [...opp.field, ...you.field];
        const pupilsOrOther = c => c.type !== 'Tool' && c.type !== 'Location';
        this.renderField(this.elements.oppField, opp.field.filter(pupilsOrOther), false);
        this.renderField(this.elements.yourField, you.field.filter(pupilsOrOther), true);
        const location = allFieldCards.find(c => c.type === 'Location') || null;
        this.renderCenterLocation(location);
        this.renderArtifacts(this.elements.oppArtifacts, opp.field.filter(c => c.type === 'Tool'), false);
        this.renderArtifacts(this.elements.yourArtifacts, you.field.filter(c => c.type === 'Tool'), true);
        this.updateBattlefieldBackground(allFieldCards);
        this.renderHand(this.elements.yourHand, you.hand);
        this.renderActionButtons();
        this.renderChoice();
        this.renderStatusMessage();
    }

    // ------------------------------------------------------------------
    // Messages
    // ------------------------------------------------------------------

    setMessage(msg) {
        this._message = msg;
        this._messageAt = Date.now();
        if (this.elements.message) this.elements.message.textContent = msg;
    }

    // What the bar says when nothing was set just now: what to do next, or
    // the latest thing that happened.
    renderStatusMessage() {
        if (!this.elements.message) return;
        if (this._message && Date.now() - (this._messageAt || 0) < 2500) return;
        const s = this.game.state;
        const me = this.localPlayer;
        const q = this.game.pendingChoice;
        let text;
        if (this.action && this.action.specs) {
            const spec = this.action.specs[this.action.targets.length];
            text = spec ? `Choose ${spec.label || 'a target'}${spec.optional ? ' (or skip)' : ''}` : '';
        } else if (q && q.player !== me) {
            text = 'Opponent is choosing…';
        } else if (s.combatStep === 'declare-attackers' && s.currentPlayer === me) {
            text = 'Tap your pupils to attack, then Attack!';
        } else if (s.combatStep === 'declare-blockers' && s.currentPlayer !== me) {
            text = this.selectedBlocker ? 'Now tap the attacker it should block' : 'Tap one of your pupils, then the attacker to block - several can gang up on one';
        } else if (s.combatStep === 'declare-blockers') {
            text = 'Waiting for your opponent to block…';
        } else {
            text = s.log && s.log.length ? s.log[s.log.length - 1] : '';
        }
        this.elements.message.textContent = text;
    }

    // ------------------------------------------------------------------
    // Resources
    // ------------------------------------------------------------------

    renderResources(container, resources, isYours = false) {
        container.innerHTML = '';
        const legal = this.legalTargetSet('resource');
        resources.forEach(res => {
            const c = res.anyColor ? { hex: '#e4e4e7', bg: '#3f3f46' } : this.getColor(res.color);
            const div = document.createElement('div');
            div.className = 'resource-token' + (res.spent ? ' spent' : '') + (legal.has(res.id) ? ' targetable' : '');
            const bg = res.anyColor
                ? 'conic-gradient(#f97316, #22c55e, #a855f7, #3b82f6, #a1a1aa, #f97316)'
                : `radial-gradient(circle at 30% 30%, ${c.hex}, ${c.bg})`;
            div.style.cssText = `background: ${bg}; border: 2px solid ${legal.has(res.id) ? '#fbbf24' : c.hex}; ${res.spent ? '' : `box-shadow: 0 0 10px ${c.hex}60;`}`;
            div.textContent = res.anyColor ? '★' : res.color;
            div.title = (res.cardName || res.color) + (res.temporary ? ' (this turn only)' : '') + (res.anyColor ? ' — any color' : '');
            if (legal.has(res.id)) div.addEventListener('click', () => this.chooseTarget(res.id));
            if (res.card && !this.isTouchDevice) {
                div.addEventListener('mouseenter', (e) => this.showHoverPreview(res.card, e));
                div.addEventListener('mouseleave', () => this.hideHoverPreview());
                div.addEventListener('mousemove', (e) => this.updateHoverPreviewPosition(e));
            }
            container.appendChild(div);
        });
    }

    // ------------------------------------------------------------------
    // Field
    // ------------------------------------------------------------------

    renderField(container, field, isYours) {
        const state = this.game.state;
        const me = this.localPlayer;
        container.innerHTML = '';
        const legal = this.legalTargetSet('card');
        const attackingIds = new Set((state.attackers || []).map(a => a.instanceId));
        // Several pupils may block one attacker
        const blockerOf = {};
        const blockedBy = {};
        for (const att of Object.keys(state.blockers || {})) {
            blockedBy[att] = this.game.blockersOf(att);
            blockedBy[att].forEach(b => { blockerOf[b] = att; });
        }

        field.forEach(card => {
            const isPupil = card.type?.includes('Pupil');
            let targetable = legal.has(card.instanceId);
            if (!this.action) {
                if (isYours && state.combatStep === 'declare-attackers' && state.currentPlayer === me) {
                    targetable = isPupil && this.game.canAttack(me, card);
                } else if (isYours && state.combatStep === 'declare-blockers' && state.currentPlayer !== me) {
                    targetable = isPupil && !card.isSpent && !this.game.cannotBlock(card);
                } else if (!isYours && state.combatStep === 'declare-blockers' && state.currentPlayer !== me && this.selectedBlocker) {
                    targetable = attackingIds.has(card.instanceId);
                }
            }
            const el = this.renderCard(card, {
                small: true,
                selected: this.selectedFieldCard?.instanceId === card.instanceId || this.selectedBlocker === card.instanceId,
                attacker: attackingIds.has(card.instanceId),
                blocker: !!blockerOf[card.instanceId],
                targetable,
                spent: card.isSpent,
                onClick: () => this.handleFieldCardClick(card, isYours)
            });
            // Say who blocks whom
            const nameOf = id => this.game.findInPlay(id)?.name || '';
            const tag = blockerOf[card.instanceId]
                ? `blocks ${nameOf(blockerOf[card.instanceId])}`
                : (blockedBy[card.instanceId]?.length ? `blocked by ${blockedBy[card.instanceId].map(nameOf).join(' + ')}` : '');
            if (tag) {
                const t = document.createElement('div');
                t.className = 'card-combat-tag';
                t.textContent = tag;
                t.style.cssText = 'position:absolute;left:0;right:0;bottom:-1.1rem;font-size:0.55rem;text-align:center;color:#93c5fd;white-space:nowrap;overflow:hidden;';
                el.style.overflow = 'visible';
                el.appendChild(t);
            }
            container.appendChild(el);
        });
    }

    renderArtifacts(container, artifacts, isYours) {
        if (!container) return;
        container.innerHTML = '';
        const legal = this.legalTargetSet('card');
        artifacts.forEach(card => {
            const el = this.renderCard(card, {
                small: true,
                spent: card.isSpent,
                targetable: legal.has(card.instanceId) || (!this.action && isYours && this.usableAbilities(card).length > 0),
                onClick: () => this.handleArtifactClick(card, isYours)
            });
            container.appendChild(el);
        });
    }

    handleArtifactClick(card, isYours) {
        if (this.action) { this.chooseTarget(card.instanceId); return; }
        if (!isYours) return;
        this.selectedFieldCard = this.selectedFieldCard?.instanceId === card.instanceId ? null : card;
        this.selectedCard = null;
        this.render();
    }

    // ------------------------------------------------------------------
    // Abilities
    // ------------------------------------------------------------------

    usableAbilities(card) {
        if (!card) return [];
        return this.game.getAbilities(this.localPlayer, card.instanceId).filter(a => a.canUse);
    }

    // ------------------------------------------------------------------
    // Playing with targets and modes
    // ------------------------------------------------------------------
    //
    // this.action = { kind: 'play'|'resource'|'ability', card, index, mode, specs, targets }
    // A card or ability that needs targets gathers them here, one tap per
    // target; the engine says what is legal, so the UI never guesses.

    startAction(kind, card, index = 0) {
        const g = this.game;
        let modes = null, specs = [];
        if (kind === 'ability') {
            const ab = g.getAbilities(this.localPlayer, card.instanceId)[index];
            if (!ab) return;
            if (!ab.canUse) { this.setMessage(ab.reason || 'Not now'); return; }
            modes = ab.modes; specs = ab.targets;
        } else {
            const o = g.getPlayOptions(this.localPlayer, card.instanceId);
            if (kind === 'play') {
                if (!o.canPlay) { this.setMessage(o.reason || 'Cannot play that now'); return; }
                modes = o.modes; specs = o.targets;
            } else {
                if (!o.canResource) { this.setMessage(o.resourceReason || 'Cannot play a resource now'); return; }
                modes = o.resourceModes; specs = o.resourceTargets;
            }
        }
        this.action = { kind, card, index, mode: undefined, specs: null, targets: [] };
        if (modes && modes.length) { this.showModePicker(modes); return; }
        this.action.specs = (specs || []).filter(Boolean);
        this.advanceAction();
    }

    showModePicker(modes) {
        this.pickingMode = modes;
        this.render();
    }

    chooseMode(i) {
        if (!this.action || !this.pickingMode) return;
        const m = this.pickingMode[i];
        this.pickingMode = null;
        this.action.mode = m.index;
        this.action.specs = (m.targets || []).filter(Boolean);
        this.advanceAction();
    }

    // Skip optional targets with nothing to choose; run when complete.
    advanceAction() {
        const a = this.action;
        if (!a) return;
        while (a.targets.length < a.specs.length) {
            const spec = a.specs[a.targets.length];
            const legal = this.game.getTargets(this.localPlayer, spec, a.card, a.targets);
            if (legal.length) break;
            if (spec.optional || spec.fizzleIfNone) { a.targets.push(undefined); continue; }
            this.setMessage(`No ${spec.label || 'target'} to choose`);
            this.action = null;
            this.render();
            return;
        }
        if (a.targets.length >= a.specs.length) { this.finishAction(); return; }
        this.render();
    }

    currentSpec() {
        const a = this.action;
        if (!a || !a.specs || a.targets.length >= a.specs.length) return null;
        return a.specs[a.targets.length];
    }

    // Which things can be tapped as the current target: 'card' or 'resource'.
    legalTargetSet(kind) {
        const spec = this.currentSpec();
        if (!spec) return new Set();
        if ((spec.kind === 'resource') !== (kind === 'resource')) return new Set();
        return new Set(this.game.getTargets(this.localPlayer, spec, this.action.card, this.action.targets));
    }

    chooseTarget(id) {
        const spec = this.currentSpec();
        if (!spec) return;
        const legal = this.game.getTargets(this.localPlayer, spec, this.action.card, this.action.targets);
        if (!legal.includes(id)) { this.setMessage(`That is not ${spec.label || 'a legal target'}`); return; }
        this.action.targets.push(id);
        this.advanceAction();
    }

    skipTarget() {
        const spec = this.currentSpec();
        if (!spec || !(spec.optional || spec.fizzleIfNone)) return;
        this.action.targets.push(undefined);
        this.advanceAction();
    }

    finishAction() {
        const a = this.action;
        this.action = null;
        this.selectedCard = null;
        this.selectedFieldCard = null;
        if (!a) return;
        const g = this.game;
        const choices = { mode: a.mode, targets: a.targets };
        let r;
        if (a.kind === 'play') r = g.playCard(this.localPlayer, a.card.instanceId, false, choices);
        else if (a.kind === 'resource') r = g.playCard(this.localPlayer, a.card.instanceId, true, choices);
        else r = g.activateAbility(this.localPlayer, a.card.instanceId, a.index, choices);
        if (!r.success) this.setMessage(r.error || 'That did not work');
        else if (r.refuted) this.setMessage(`${a.card.name} was refuted!`);
        else if (r.prevented) this.setMessage(`${a.card.name} was prevented from entering!`);
        this.render();
    }

    cancelAction() {
        this.action = null;
        this.pickingMode = null;
        this.render();
    }

    actionStillValid() {
        const a = this.action;
        if (!a) return false;
        const g = this.game;
        if (g.pendingChoice) return false;
        if (a.kind === 'ability') return !!g.abilityHost(this.localPlayer, a.card.instanceId);
        return g.state.players[this.localPlayer].hand.some(c => c.instanceId === a.card.instanceId);
    }

    // Kept for old callers
    enterTargetingMode(sourceCard) { this.startAction('ability', sourceCard, 0); }
    exitTargetingMode() { this.action = null; }
    cancelTargeting() { this.cancelAction(); }
    get targetingMode() { return !!this.action; }

    // ------------------------------------------------------------------
    // Location
    // ------------------------------------------------------------------

    renderCenterLocation(location) {
        const container = this.elements.centerLocation;
        if (!container) return;
        container.innerHTML = '';
        if (!location) return;
        const locationIcons = {
            'Parking Lot': '🚗', 'The Workshop': '🔧', 'Field': '🌿', 'Gym/Weights Room': '🏋️', 'Cafeteria': '🍽️',
            'The Lab': '🔬', 'Music Room': '🎵', 'The Amphitheater': '🎭', 'The Counselor\'s Office': '💬',
            'Auditorium': '🎬', 'The Office': '📋', 'The Computer Lab': '💻', 'Server Room': '🖥️', 'Library': '📚',
            'Playground': '🎢', 'University': '🎓'
        };
        const icon = locationIcons[location.name] || '🏛️';
        const usable = this.usableAbilities(location);
        const el = document.createElement('div');
        el.className = 'location-card' + (usable.length ? ' has-ability' : '');
        el.innerHTML = `
            <span class="location-icon">${icon}</span>
            <div class="location-info">
                <span class="location-name">${this.esc(location.name)}</span>
                <span class="location-ability">${this.esc(location.ability || 'No effect')}</span>
            </div>`;
        if (usable.length) {
            el.style.cursor = 'pointer';
            el.title = 'Tap to use: ' + usable.map(a => a.label).join(', ');
            el.addEventListener('click', () => {
                this.selectedFieldCard = this.selectedFieldCard?.instanceId === location.instanceId ? null : location;
                this.render();
            });
        } else if (this.isTouchDevice) {
            el.addEventListener('click', () => this.showPreview(location));
        }
        if (!this.isTouchDevice) {
            el.addEventListener('mouseenter', (e) => this.showHoverPreview(location, e));
            el.addEventListener('mouseleave', () => this.hideHoverPreview());
            el.addEventListener('mousemove', (e) => this.updateHoverPreviewPosition(e));
        }
        container.appendChild(el);
    }

    esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    // ------------------------------------------------------------------
    // Clicks
    // ------------------------------------------------------------------

    handleHandCardClick(card) {
        if (this.game.pendingChoice) return;
        if (this.action) return;
        const o = this.game.getPlayOptions(this.localPlayer, card.instanceId);
        if (!o.canPlay && !o.canResource) {
            this.setMessage(o.reason || o.resourceReason || 'Not now');
            this.selectedCard = null;
            this.render();
            return;
        }
        this.selectedCard = this.selectedCard?.instanceId === card.instanceId ? null : card;
        this.selectedFieldCard = null;
        this.render();
        this.onCardClick(card, 'hand');
    }

    handleFieldCardClick(card, isYours) {
        const g = this.game;
        const state = g.state;
        const me = this.localPlayer;
        if (g.pendingChoice) return;

        if (this.action) { this.chooseTarget(card.instanceId); return; }

        if (state.combatStep === 'declare-attackers' && state.currentPlayer === me) {
            if (isYours && card.type?.includes('Pupil')) {
                const r = g.toggleAttacker(me, card.instanceId);
                if (!r.success) this.setMessage(r.error);
                this.render();
            }
            return;
        }

        if (state.combatStep === 'declare-blockers' && state.currentPlayer !== me) {
            const attackers = (state.attackers || []).map(a => a.instanceId);
            if (isYours && card.type?.includes('Pupil')) {
                // Tap an assigned blocker to take it back
                if (g.isBlocking(card.instanceId)) { g.toggleBlocker(me, card.instanceId, null); this.selectedBlocker = null; this.render(); return; }
                if (card.isSpent || g.cannotBlock(card)) { this.setMessage(`${card.name} cannot block`); return; }
                if (attackers.length === 1) {
                    const r = g.toggleBlocker(me, card.instanceId, attackers[0]);
                    if (!r.success) this.setMessage(r.error);
                    this.selectedBlocker = null;
                } else {
                    this.selectedBlocker = this.selectedBlocker === card.instanceId ? null : card.instanceId;
                }
                this.render();
                return;
            }
            if (!isYours && this.selectedBlocker && attackers.includes(card.instanceId)) {
                const r = g.toggleBlocker(me, this.selectedBlocker, card.instanceId);
                if (!r.success) this.setMessage(r.error);
                this.selectedBlocker = null;
                this.render();
            }
            return;
        }

        if (isYours) {
            this.selectedFieldCard = this.selectedFieldCard?.instanceId === card.instanceId ? null : card;
            this.selectedCard = null;
            if (this.selectedFieldCard) {
                const abs = g.getAbilities(me, card.instanceId);
                if (!abs.length) this.setMessage(`${card.name}: ${card.ability && card.ability !== 'None' ? card.ability : 'no ability to use'}`);
                else if (card.hasGettingBearings && card.type?.includes('Pupil') && abs.some(a => a.spend)) this.setMessage(`${card.name} is getting its bearings`);
            }
            this.render();
        }
        this.onCardClick(card, 'field');
    }

    // ------------------------------------------------------------------
    // Buttons
    // ------------------------------------------------------------------

    renderActionButtons() {
        const g = this.game;
        const state = g.state;
        const me = this.localPlayer;
        const isYourTurn = state.currentPlayer === me;
        const btns = this.elements.actionButtons;
        btns.innerHTML = '';
        if (state.gameOver) return;

        // Choosing a mode
        if (this.pickingMode) {
            this.pickingMode.forEach((m, i) => btns.appendChild(this.createButton(m.label, 'btn-purple', () => this.chooseMode(i))));
            btns.appendChild(this.createButton('✕ Cancel', 'btn-secondary', () => this.cancelAction()));
            return;
        }
        // Choosing targets
        if (this.action) {
            const spec = this.currentSpec();
            if (spec && (spec.optional || spec.fizzleIfNone)) btns.appendChild(this.createButton('Skip', 'btn-secondary', () => this.skipTarget()));
            btns.appendChild(this.createButton('✕ Cancel', 'btn-danger', () => this.cancelAction()));
            return;
        }
        if (g.pendingChoice) return;

        // A selected card in play: its abilities
        if (this.selectedFieldCard) {
            const card = this.selectedFieldCard;
            const abs = g.getAbilities(me, card.instanceId);
            abs.forEach(a => {
                const b = this.createButton(`⚡ ${a.label}${a.cost ? ' ' + a.cost : ''}`, a.canUse ? 'btn-purple' : 'btn-secondary',
                    () => { this.selectedFieldCard = null; this.startAction('ability', card, a.index); });
                if (!a.canUse) { b.disabled = true; b.title = a.reason || ''; b.style.opacity = '0.5'; }
                btns.appendChild(b);
            });
            btns.appendChild(this.createButton('✕', 'btn-secondary', () => { this.selectedFieldCard = null; this.render(); }));
            return;
        }

        // A selected card in hand
        if (this.selectedCard) {
            const card = this.selectedCard;
            const o = g.getPlayOptions(me, card.instanceId);
            if (o.canResource) btns.appendChild(this.createButton('🔋 Resource', 'btn-secondary', () => this.startAction('resource', card)));
            const play = this.createButton('▶️ Play', o.canPlay ? 'btn-success' : 'btn-secondary', () => this.startAction('play', card));
            if (!o.canPlay) { play.style.opacity = '0.5'; play.title = o.reason || ''; }
            btns.appendChild(play);
            btns.appendChild(this.createButton('✕', 'btn-secondary', () => { this.selectedCard = null; this.render(); }));
            return;
        }

        if (state.combatStep === 'declare-attackers' && isYourTurn) {
            btns.appendChild(this.createButton('No attack', 'btn-secondary', () => {
                [...state.attackers].forEach(a => g.toggleAttacker(me, a.instanceId));
                g.confirmAttackers(me);
                this.render();
            }));
            const confirmBtn = this.createButton(`✓ Attack! (${state.attackers.length})`, 'btn-danger', () => {
                const r = g.confirmAttackers(me);
                if (!r.success) this.setMessage(r.error);
                this.render();
            });
            if (state.attackers.length) confirmBtn.style.animation = 'pulse 1s infinite';
            btns.appendChild(confirmBtn);
            return;
        }

        if (state.combatStep === 'declare-blockers' && !isYourTurn) {
            const doneBtn = this.createButton('✓ Done Blocking', 'btn-primary', () => {
                const r = g.confirmBlockers(me);
                if (!r.success) this.setMessage(r.error);
                this.selectedBlocker = null;
                this.render();
            });
            doneBtn.style.animation = 'pulse 1s infinite';
            btns.appendChild(doneBtn);
            return;
        }

        if (isYourTurn && !state.combatStep && state.phase === 'main' && !state.players[me].flags.combatDone) {
            btns.appendChild(this.createButton('⚔️ Combat', 'btn-danger', () => {
                const r = g.startCombat(me);
                if (!r.success) this.setMessage(r.error);
                this.render();
            }));
        }
        if (isYourTurn && !state.combatStep) {
            btns.appendChild(this.createButton('End Turn →', 'btn-warning', () => {
                const r = g.endTurn(me);
                if (!r.success) this.setMessage(r.error);
                this.render();
            }));
        }
        if (this.onConcede && !state.gameOver) {
            btns.appendChild(this.createButton('🏳 Concede', 'btn-danger', () => {
                if (confirm('Concede this match? It counts as a loss.')) this.onConcede();
            }));
        }
    }

    // ------------------------------------------------------------------
    // Decisions the engine asks the local player for
    // ------------------------------------------------------------------

    renderChoice() {
        let host = document.getElementById('riutiz-choice');
        const q = this.game.pendingChoice;
        if (!q || q.player !== this.localPlayer || this.game.state.gameOver) {
            if (host) host.remove();
            this._choiceId = null;
            return;
        }
        if (host && this._choiceId === q.id) return;     // already showing this one
        this._choiceId = q.id;
        this._picked = [];
        if (!host) {
            host = document.createElement('div');
            host.id = 'riutiz-choice';
            host.style.cssText = 'position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:1rem;';
            document.body.appendChild(host);
        }
        const draw = () => {
            const picked = this._picked;
            const isOrder = q.kind === 'order';
            const reveal = q.reveal || q.max === 0;
            host.innerHTML = '';
            const box = document.createElement('div');
            box.style.cssText = 'background:#18181b;border:2px solid #3b82f6;border-radius:1rem;padding:1rem;max-width:44rem;width:100%;max-height:85vh;overflow:auto;';
            const title = document.createElement('div');
            title.style.cssText = 'font-weight:bold;font-size:1rem;margin-bottom:0.25rem;color:#e4e4e7;';
            title.textContent = q.sourceName ? `${q.sourceName}: ${q.prompt}` : q.prompt;
            const sub = document.createElement('div');
            sub.style.cssText = 'font-size:0.75rem;color:#a1a1aa;margin-bottom:0.75rem;';
            sub.textContent = reveal ? '' : isOrder ? 'Tap them in order: first tapped goes on top.'
                : q.min === q.max ? `Choose ${q.min}.` : `Choose ${q.min === 0 ? 'up to ' : q.min + ' to '}${q.max}.`;
            box.appendChild(title); box.appendChild(sub);
            const grid = document.createElement('div');
            grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.5rem;justify-content:center;margin-bottom:0.75rem;';
            (q.options || []).forEach(o => {
                const idx = picked.indexOf(o.value);
                let el;
                if (o.card) {
                    el = this.renderCard(o.card, { inHand: true, selected: idx >= 0, onClick: () => toggle(o.value) });
                    el.style.position = 'relative';
                    if (idx >= 0 && isOrder) {
                        const n = document.createElement('div');
                        n.textContent = String(idx + 1);
                        n.style.cssText = 'position:absolute;top:0.25rem;left:0.25rem;background:#facc15;color:#000;border-radius:50%;width:1.4rem;height:1.4rem;display:flex;align-items:center;justify-content:center;font-weight:bold;';
                        el.appendChild(n);
                    }
                } else {
                    el = this.createButton(o.label, idx >= 0 ? 'btn-primary' : 'btn-secondary', () => toggle(o.value));
                }
                grid.appendChild(el);
            });
            box.appendChild(grid);
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:0.5rem;justify-content:flex-end;';
            const n = picked.length;
            const valid = reveal || (isOrder ? n === q.options.length : n >= q.min && n <= q.max);
            const done = this.createButton(reveal ? 'OK' : q.min === 0 && n === 0 ? 'Skip' : 'Confirm', valid ? 'btn-success' : 'btn-secondary', () => {
                if (!valid) return;
                const r = this.game.resolveChoice(this.localPlayer, reveal ? [] : picked);
                if (!r.success) { this.setMessage(r.error); return; }
                this._choiceId = null;
                host.remove();
                this.render();
            });
            if (!valid) done.style.opacity = '0.5';
            row.appendChild(done);
            box.appendChild(row);
            host.appendChild(box);
        };
        const toggle = (v) => {
            if (q.reveal || q.max === 0) return;
            const i = this._picked.indexOf(v);
            if (i >= 0) this._picked.splice(i, 1);
            else if (q.kind === 'order' || this._picked.length < q.max) this._picked.push(v);
            else if (q.max === 1) this._picked = [v];
            draw();
        };
        draw();
    }

    /**
     * Show victory screen
     */
    showVictoryScreen(winner, p1Points, p2Points) {
        this.elements.menuScreen?.classList.add('hidden');
        this.elements.gameScreen?.classList.add('hidden');
        this.elements.victoryScreen?.classList.remove('hidden');
        document.getElementById('riutiz-choice')?.remove();
        const localWon = winner === this.localPlayer;
        const reason = this.game.state?.endReason === 'deck' ? ' — a deck ran out of cards' : '';
        this.elements.winnerText.textContent = (localWon ? 'You Win!' : 'Opponent Wins!') + reason;
        this.elements.finalScore.textContent = `Final Score: ${p1Points} - ${p2Points}`;
    }

    /**
     * Drop a dragged hand card: on the resource zone, as a resource; on the
     * field, played (asking for targets first if it needs them).
     */
    handleDrop(e, zone) {
        e.preventDefault();
        e.currentTarget.style.background = '';
        e.currentTarget.style.borderColor = '';
        const card = this.draggedCard;
        if (!card) return;
        this.selectedCard = null;
        this.startAction(zone === 'resource' ? 'resource' : 'play', card);
    }


    /**
     * Create a button element
     */
    createButton(text, className, onClick) {
        const btn = document.createElement('button');
        btn.className = 'btn ' + className;
        btn.textContent = text;
        if (onClick) btn.onclick = onClick;
        return btn;
    }



    /**
     * Show game screen
     */
    showGameScreen() {
        this.elements.menuScreen?.classList.add('hidden');
        this.elements.gameScreen?.classList.remove('hidden');
        this.elements.victoryScreen?.classList.add('hidden');
    }


}

// Export
window.RiutizUI = RiutizUI;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RiutizUI };
}
