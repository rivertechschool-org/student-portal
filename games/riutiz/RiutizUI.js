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
        this.pendingAbility = null;  // { card, targetType, effect, ... }
        this.targetingMode = false;

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
            'relentless': 'Can attack even while spent/tapped',
            'grounded': 'Cannot attack, but can still block',
            'lethal': 'Any damage defeats the target regardless of Endurance',
            'stubborn': 'Cannot be defeated by combat damage alone',
            'non-sequitur': 'Triggers a random coin-flip effect',
            'overwhelm': 'Excess damage beyond blocker\'s Endurance scores as points',
            'interject': 'Triggers an effect when entering the battlefield',
            'lockdown': 'Target cannot attack or block',
            'closed-minded': 'Cannot gain new abilities or receive buffs'
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
     * Render full game state
     */
    render() {
        const state = this.game.state;
        if (!state) return;

        const isYourTurn = state.currentPlayer === this.localPlayer;
        const you = state.players[this.localPlayer];
        const opp = state.players[this.localPlayer === 1 ? 2 : 1];

        // Update points
        this.elements.oppPoints.textContent = opp.points + ' pts';
        this.elements.yourPoints.textContent = you.points + ' pts';

        // Update deck/hand counts
        this.elements.oppHandCount.textContent = opp.hand.length;
        this.elements.oppDeckCount.textContent = opp.deck.length;
        this.elements.yourHandCount.textContent = you.hand.length;
        this.elements.yourDeckCount.textContent = you.deck.length;

        // Turn number
        this.elements.turnNumber.textContent = state.turn;

        // Phase indicator
        document.querySelectorAll('.phase').forEach(el => {
            el.classList.toggle('active', el.dataset.phase === state.phase);
        });

        // Turn indicator
        this.elements.turnIndicator.textContent = isYourTurn ? 'Your Turn' : "Opponent's Turn";
        this.elements.turnIndicator.className = 'turn-indicator ' + (isYourTurn ? 'your-turn' : 'opp-turn');

        // Field hint (optional element)
        if (this.elements.fieldHint) {
            this.elements.fieldHint.textContent =
                state.combatStep === 'declare-attackers' && isYourTurn ? '(Tap to attack!)' : '';
        }

        // Render resources
        this.renderResources(this.elements.oppResources, opp.resources);
        this.renderResources(this.elements.yourResources, you.resources, true);

        // Separate field cards into creatures, locations, and artifacts
        const allFieldCards = [...opp.field, ...you.field];
        const oppCreatures = opp.field.filter(c => c.type !== 'Tool' && c.type !== 'Location');
        const oppArtifacts = opp.field.filter(c => c.type === 'Tool');
        const yourCreatures = you.field.filter(c => c.type !== 'Tool' && c.type !== 'Location');
        const yourArtifacts = you.field.filter(c => c.type === 'Tool');

        // Get the active location (most recently played)
        const allLocations = allFieldCards.filter(c => c.type === 'Location');
        const activeLocation = allLocations.length > 0 ? allLocations[allLocations.length - 1] : null;

        // Render fields (creatures only, no locations or tools)
        this.renderField(this.elements.oppField, oppCreatures, false);
        this.renderField(this.elements.yourField, yourCreatures, true);

        // Render center location
        this.renderCenterLocation(activeLocation);

        // Render artifacts
        this.renderArtifacts(this.elements.oppArtifacts, oppArtifacts, false);
        this.renderArtifacts(this.elements.yourArtifacts, yourArtifacts, true);

        // Update battlefield background based on active location
        this.updateBattlefieldBackground(allFieldCards);

        // Render hand
        this.renderHand(this.elements.yourHand, you.hand);

        // Render action buttons
        this.renderActionButtons();
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
     * Render resources
     */
    renderResources(container, resources, isYours = false) {
        container.innerHTML = '';

        if (resources.length === 0) {
            // No message for empty resources in the new compact layout
            return;
        }

        resources.forEach(res => {
            const c = this.getColor(res.color);
            const div = document.createElement('div');
            div.className = 'resource-token' + (res.spent ? ' spent' : '');
            div.style.cssText = `background: radial-gradient(circle at 30% 30%, ${c.hex}, ${c.bg}); border: 2px solid ${c.hex}; ${res.spent ? '' : `box-shadow: 0 0 10px ${c.hex}60;`}`;
            div.textContent = res.color;
            div.title = res.cardName || res.color; // Tooltip fallback

            // Add preview functionality if card data exists
            if (res.card) {
                // PC: Hover preview
                if (!this.isTouchDevice) {
                    div.addEventListener('mouseenter', (e) => {
                        this.showHoverPreview(res.card, e);
                    });
                    div.addEventListener('mouseleave', () => {
                        this.hideHoverPreview();
                    });
                    div.addEventListener('mousemove', (e) => {
                        this.updateHoverPreviewPosition(e);
                    });
                }

                // Mobile: Long press preview
                if (this.isTouchDevice) {
                    let touchTimer = null;
                    let touchMoved = false;

                    div.addEventListener('touchstart', () => {
                        touchMoved = false;
                        touchTimer = setTimeout(() => {
                            if (!touchMoved) {
                                this.showPreview(res.card);
                            }
                        }, 400);
                    }, { passive: true });

                    div.addEventListener('touchmove', () => {
                        touchMoved = true;
                        if (touchTimer) {
                            clearTimeout(touchTimer);
                            touchTimer = null;
                        }
                    }, { passive: true });

                    div.addEventListener('touchend', () => {
                        if (touchTimer) {
                            clearTimeout(touchTimer);
                            touchTimer = null;
                        }
                    });
                }
            }

            container.appendChild(div);
        });
    }

    /**
     * Render field - Arena style
     */
    renderField(container, field, isYours) {
        const state = this.game.state;
        container.innerHTML = '';

        if (field.length === 0) {
            // Empty field - no message, just empty space
            return;
        }

        field.forEach(card => {
            const isPupil = card.type?.includes('Pupil');
            const isYourTurn = state.currentPlayer === this.localPlayer;

            // Determine card state
            const isAttacker = state.attackers.find(a => a.instanceId === card.instanceId);
            const isBlocker = Object.values(state.blockers).includes(card.instanceId);

            let targetable = false;

            // Check if this card is a valid target in targeting mode
            if (this.targetingMode && this.pendingAbility) {
                const { targetType } = this.pendingAbility;
                if (targetType === 'friendlyPupil' && isYours && isPupil) targetable = true;
                if (targetType === 'enemyPupil' && !isYours && isPupil) targetable = true;
                if (targetType === 'anyPupil' && isPupil) targetable = true;
                if (targetType === 'friendlyCreature' && isYours) targetable = true;
                if (targetType === 'anyCreature') targetable = true;
            }
            // Normal combat targeting
            else if (isYours && state.combatStep === 'declare-attackers' && isYourTurn) {
                const isGrounded = card.ability?.toLowerCase().includes('grounded');
                targetable = isPupil && !card.hasGettingBearings && (!card.isSpent || card.ability?.toLowerCase().includes('relentless')) && !isGrounded;
            } else if (isYours && state.combatStep === 'declare-blockers' && !isYourTurn) {
                targetable = isPupil && !card.isSpent && !card.cannotBlock;
            }

            const isSelected = this.selectedFieldCard?.instanceId === card.instanceId;

            const el = this.renderCard(card, {
                small: true,
                selected: isSelected,
                attacker: isAttacker,
                blocker: isBlocker,
                targetable: targetable,
                spent: card.isSpent,
                onClick: () => this.handleFieldCardClick(card, isYours)
            });

            container.appendChild(el);
        });
    }

    /**
     * Render artifacts - compact display in corner
     */
    renderArtifacts(container, artifacts, isYours) {
        if (!container) return;
        container.innerHTML = '';

        if (artifacts.length === 0) {
            return;
        }

        artifacts.forEach(card => {
            const hasSpendAbility = /\bspend\s*[:,]/.test(card.ability?.toLowerCase() || '');

            const el = this.renderCard(card, {
                small: true,
                spent: card.isSpent,
                targetable: hasSpendAbility && !card.isSpent && isYours,
                onClick: () => this.handleArtifactClick(card, isYours)
            });

            container.appendChild(el);
        });
    }

    /**
     * Handle artifact click (for spend abilities)
     */
    handleArtifactClick(card, isYours) {
        if (!isYours) return;

        // If in targeting mode, this artifact could be a target
        if (this.targetingMode && this.pendingAbility) {
            this.handleTargetSelection(card);
            return;
        }

        const hasSpendAbility = /\bspend\s*[:,]/.test(card.ability?.toLowerCase() || '');
        if (hasSpendAbility && !card.isSpent) {
            // Try to activate spend ability
            const result = this.game.activateAbility(this.localPlayer, card.instanceId);

            if (result.needsTarget) {
                // Enter targeting mode
                this.enterTargetingMode(card, result);
            } else if (result.success) {
                this.setMessage(`Activated ${card.name}!`);
                this.render();
            } else {
                this.setMessage(result.error || "Can't activate");
                this.render();
            }
        }
    }

    /**
     * Enter targeting mode for an ability
     */
    enterTargetingMode(sourceCard, abilityInfo) {
        this.targetingMode = true;
        this.pendingAbility = {
            sourceCard,
            ...abilityInfo
        };

        const targetTypeNames = {
            'friendlyPupil': 'one of your pupils',
            'enemyPupil': "an opponent's pupil",
            'anyPupil': 'any pupil',
            'friendlyCreature': 'one of your creatures',
            'anyCreature': 'any creature'
        };

        const targetName = targetTypeNames[abilityInfo.targetType] || 'a target';
        this.setMessage(`Select ${targetName} for ${sourceCard.name}`);
        this.render();
    }

    /**
     * Handle target selection when in targeting mode
     */
    handleTargetSelection(targetCard) {
        if (!this.pendingAbility) return;

        const { sourceCard, targetType } = this.pendingAbility;
        const state = this.game.state;
        const you = state.players[this.localPlayer];
        const opp = state.players[this.localPlayer === 1 ? 2 : 1];

        // Validate target based on targetType
        const isYourCard = you.field.some(c => c.instanceId === targetCard.instanceId);
        const isOppCard = opp.field.some(c => c.instanceId === targetCard.instanceId);
        const isPupil = targetCard.type?.includes('Pupil');

        let validTarget = false;

        if (targetType === 'friendlyPupil' && isYourCard && isPupil) validTarget = true;
        if (targetType === 'enemyPupil' && isOppCard && isPupil) validTarget = true;
        if (targetType === 'anyPupil' && isPupil) validTarget = true;
        if (targetType === 'friendlyCreature' && isYourCard) validTarget = true;
        if (targetType === 'anyCreature') validTarget = true;

        if (!validTarget) {
            this.setMessage('Invalid target!');
            return;
        }

        // Execute the ability with the target
        const result = this.game.activateAbility(this.localPlayer, sourceCard.instanceId, targetCard);

        if (result.success) {
            this.setMessage(`${sourceCard.name} targeted ${targetCard.name}!`);
        } else {
            this.setMessage(result.error || 'Ability failed');
        }

        // Exit targeting mode
        this.exitTargetingMode();
        this.render();
    }

    /**
     * Exit targeting mode
     */
    exitTargetingMode() {
        this.targetingMode = false;
        this.pendingAbility = null;
    }

    /**
     * Cancel current targeting
     */
    cancelTargeting() {
        this.exitTargetingMode();
        this.setMessage('Targeting cancelled');
        this.render();
    }

    /**
     * Render center location card
     */
    renderCenterLocation(location) {
        const container = this.elements.centerLocation;
        if (!container) return;

        container.innerHTML = '';

        if (!location) {
            return;
        }

        // Location icon map
        const locationIcons = {
            'Parking Lot': '🚗',
            'The Workshop': '🔧',
            'Field': '🌿',
            'Gym/Weights Room': '🏋️',
            'Cafeteria': '🍽️',
            'The Lab': '🔬',
            'Music Room': '🎵',
            'The Amphitheater': '🎭',
            'The Counselor\'s Office': '💬',
            'Auditorium': '🎬',
            'The Office': '📋',
            'The Computer Lab': '💻',
            'Server Room': '🖥️',
            'Library': '📚',
            'Playground': '🎢',
            'University': '🎓'
        };

        const icon = locationIcons[location.name] || '🏛️';
        const abilityText = location.ability || 'No effect';

        const locationEl = document.createElement('div');
        locationEl.className = 'location-card';
        locationEl.innerHTML = `
            <span class="location-icon">${icon}</span>
            <div class="location-info">
                <span class="location-name">${location.name}</span>
                <span class="location-ability">${abilityText}</span>
            </div>
        `;

        // Add hover/click preview
        if (!this.isTouchDevice) {
            locationEl.addEventListener('mouseenter', (e) => {
                this.showHoverPreview(location, e);
            });
            locationEl.addEventListener('mouseleave', () => {
                this.hideHoverPreview();
            });
            locationEl.addEventListener('mousemove', (e) => {
                this.updateHoverPreviewPosition(e);
            });
        } else {
            // Mobile: tap to show full preview
            locationEl.addEventListener('click', () => {
                this.showPreview(location);
            });
        }

        container.appendChild(locationEl);
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
        const hasSpendAbility = /\bspend\s*[:,]/.test(card.ability?.toLowerCase() || '');

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
                ${isPupil ? `<div class="card-stats"><span class="stat-dice">🎲 ${card.dice}${(card.dieRollBonus || card.cumulativeDieBonus) ? ` +${(card.dieRollBonus || 0) + (card.cumulativeDieBonus || 0)}` : ''}</span><span class="stat-hp">❤️ ${(card.currentEndurance ?? card.endurance) + (card.auraEnduranceBonus || 0) + (card.counters?.plusOne || 0)}${card.auraDamageReduction ? ` 🛡${card.auraDamageReduction}` : ''}</span></div>` : ''}
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
                    <span style="color: #fbbf24;" title="Attack Dice">🎲 ${card.dice}</span>
                    <span style="color: #3b82f6;" title="Attack Damage (points scored when unblocked)">⚔️ ${card.ad}</span>
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
     * Handle drop
     */
    handleDrop(e, zone) {
        e.preventDefault();
        e.currentTarget.style.background = '';
        e.currentTarget.style.borderColor = '';

        if (!this.draggedCard) return;

        const state = this.game.state;
        const isYourTurn = state.currentPlayer === this.localPlayer;

        if (!isYourTurn || state.phase !== 'main') {
            this.setMessage("Can't play cards right now");
            return;
        }

        const asResource = zone === 'resource';
        const result = this.game.playCard(this.localPlayer, this.draggedCard.instanceId, asResource);

        if (!result.success) {
            this.setMessage(result.error);
        } else {
            this.setMessage(asResource ? 'Played as resource!' : `Played ${this.draggedCard.name}!`);
        }

        this.selectedCard = null;
        this.render();
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
                ${isPupil ? `<div class="preview-stats"><span style="color: #fbbf24">🎲 ${card.dice}</span><span style="color: #3b82f6">⚔️ AD: ${card.ad}</span><span style="color: #ef4444">❤️ ${card.currentEndurance ?? card.endurance}</span></div>` : ''}
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
     * Handle hand card click
     */
    handleHandCardClick(card) {
        const state = this.game.state;
        const isYourTurn = state.currentPlayer === this.localPlayer;

        if (!isYourTurn || state.phase !== 'main') return;

        if (this.selectedCard?.instanceId === card.instanceId) {
            this.selectedCard = null;
        } else {
            this.selectedCard = card;
            this.selectedFieldCard = null;
        }

        this.render();
        this.onCardClick(card, 'hand');
    }

    /**
     * Handle field card click
     */
    handleFieldCardClick(card, isYours) {
        const state = this.game.state;
        const isYourTurn = state.currentPlayer === this.localPlayer;

        // If in targeting mode, handle target selection
        if (this.targetingMode && this.pendingAbility) {
            this.handleTargetSelection(card);
            return;
        }

        // Combat actions
        if (state.combatStep === 'declare-attackers' && isYours && isYourTurn) {
            if (card.type?.includes('Pupil')) {
                const result = this.game.toggleAttacker(this.localPlayer, card.instanceId);
                if (!result.success) {
                    this.setMessage(result.error);
                }
                this.render();
            }
            return;
        }

        if (state.combatStep === 'declare-blockers') {
            // Only the defender assigns blockers, and only from its own pupils
            if (isYourTurn || !isYours) return;
            const isPupil = card.type?.includes('Pupil');
            if (!isPupil || card.isSpent) return;

            // Find first unblocked attacker
            const unblockedAttacker = state.attackers.find(a => !state.blockers[a.instanceId]);
            if (unblockedAttacker) {
                const result = this.game.toggleBlocker(this.localPlayer, card.instanceId, unblockedAttacker.instanceId);
                if (!result.success) this.setMessage(result.error);
                this.render();
            }
            return;
        }

        // Main phase field card selection
        if (state.phase === 'main' && isYourTurn && isYours && !state.combatStep) {
            if (this.selectedFieldCard?.instanceId === card.instanceId) {
                this.selectedFieldCard = null;
                this.setMessage(''); // Clear the message when deselecting
            } else {
                this.selectedFieldCard = card;
                this.selectedCard = null;

                const hasSpend = /\bspend\s*[:,]/.test(card.ability?.toLowerCase() || '');
                const isPupil = card.type?.includes('Pupil');
                const hasGettingBearings = card.hasGettingBearings && isPupil;

                if (hasSpend && hasGettingBearings) {
                    this.setMessage(card.name + ' has Getting Bearings - wait a turn to activate');
                } else if (hasSpend && !card.isSpent) {
                    this.setMessage(card.name + ': ' + card.ability);
                } else if (card.isSpent) {
                    this.setMessage(card.name + ' is Spent - will ready next turn.');
                } else {
                    this.setMessage(card.name + ': ' + (card.ability || 'No activated ability.'));
                }
            }
            this.render();
        }

        this.onCardClick(card, 'field');
    }

    /**
     * Render action buttons
     */
    renderActionButtons() {
        const state = this.game.state;
        const isYourTurn = state.currentPlayer === this.localPlayer;
        const btns = this.elements.actionButtons;
        btns.innerHTML = '';

        // Targeting mode - show cancel button
        if (this.targetingMode) {
            btns.appendChild(this.createButton('✕ Cancel', 'btn-danger', () => {
                this.cancelTargeting();
            }));
            return;
        }

        // Field card activation
        if (this.selectedFieldCard && state.phase === 'main' && isYourTurn && !state.combatStep) {
            const card = this.selectedFieldCard;
            const hasSpend = /\bspend\s*[:,]/.test(card.ability?.toLowerCase() || '');
            const isPupil = card.type?.includes('Pupil');
            const hasGettingBearings = card.hasGettingBearings && isPupil;

            if (hasSpend && !card.isSpent && !hasGettingBearings) {
                btns.appendChild(this.createButton('⚡ Activate', 'btn-purple', () => {
                    const result = this.game.activateAbility(this.localPlayer, card.instanceId);
                    if (!result.success) {
                        this.setMessage(result.error);
                    }
                    this.selectedFieldCard = null;
                    this.render();
                }));
            } else if (hasSpend && hasGettingBearings) {
                // Show disabled state for Getting Bearings
                this.setMessage(card.name + ' has Getting Bearings - wait a turn to activate');
            }
            btns.appendChild(this.createButton('✕ Cancel', 'btn-secondary', () => {
                this.selectedFieldCard = null;
                this.setMessage(''); // Clear the message when cancelling
                this.render();
            }));
            return;
        }

        // Hand card actions
        if (this.selectedCard && state.phase === 'main' && isYourTurn && !this.selectedFieldCard) {
            btns.appendChild(this.createButton('🔋 Resource', 'btn-secondary', () => {
                const result = this.game.playCard(this.localPlayer, this.selectedCard.instanceId, true);
                if (!result.success) this.setMessage(result.error);
                this.selectedCard = null;
                this.render();
            }));

            const canPay = this.game.canAfford(this.selectedCard, state.players[this.localPlayer]);
            const playBtn = this.createButton('▶️ Play', canPay ? 'btn-success' : 'btn-secondary', () => {
                const result = this.game.playCard(this.localPlayer, this.selectedCard.instanceId, false);
                if (!result.success) {
                    this.setMessage(result.error);
                }
                this.selectedCard = null;
                this.render();
            });
            if (!canPay) playBtn.style.opacity = '0.5';
            btns.appendChild(playBtn);
            return;
        }

        // Combat button
        if (state.phase === 'main' && isYourTurn && !this.selectedCard && !this.selectedFieldCard) {
            btns.appendChild(this.createButton('⚔️ Combat', 'btn-danger', () => {
                this.game.startCombat(this.localPlayer);
                this.render();
            }));
        }

        // Declare attackers
        if (state.combatStep === 'declare-attackers' && isYourTurn) {
            btns.appendChild(this.createButton('Skip', 'btn-secondary', () => {
                this.game.confirmAttackers(this.localPlayer);
                this.render();
            }));

            const confirmBtn = this.createButton(`✓ Attack! (${state.attackers.length})`, 'btn-danger');
            confirmBtn.style.animation = 'pulse 1s infinite';
            confirmBtn.onclick = () => {
                this.game.confirmAttackers(this.localPlayer);
                this.render();
            };
            btns.appendChild(confirmBtn);
        }

        // Declare blockers - the defender's button (the AI confirms its own)
        if (state.combatStep === 'declare-blockers' && !isYourTurn) {
            const doneBtn = this.createButton('✓ Done Blocking', 'btn-primary');
            doneBtn.style.animation = 'pulse 1s infinite';
            doneBtn.onclick = () => {
                this.game.confirmBlockers();
                this.render();
            };
            btns.appendChild(doneBtn);
        }

        // End turn
        if ((state.phase === 'main' || state.phase === 'end') && isYourTurn && !state.combatStep && !this.selectedFieldCard) {
            btns.appendChild(this.createButton('End Turn →', 'btn-warning', () => {
                this.game.endTurn(this.localPlayer);
                this.render();
            }));
        }

        // Online: the only way out of a match used to be closing the tab
        if (this.onConcede && !state.gameOver) {
            btns.appendChild(this.createButton('🏳 Concede', 'btn-danger', () => {
                if (confirm('Concede this match? It counts as a loss.')) this.onConcede();
            }));
        }
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
     * Set message bar text
     */
    setMessage(msg) {
        this.elements.message.textContent = msg;
    }

    /**
     * Show game screen
     */
    showGameScreen() {
        this.elements.menuScreen?.classList.add('hidden');
        this.elements.gameScreen?.classList.remove('hidden');
        this.elements.victoryScreen?.classList.add('hidden');
    }

    /**
     * Show victory screen
     */
    showVictoryScreen(winner, p1Points, p2Points) {
        this.elements.menuScreen?.classList.add('hidden');
        this.elements.gameScreen?.classList.add('hidden');
        this.elements.victoryScreen?.classList.remove('hidden');

        const localWon = winner === this.localPlayer;
        this.elements.winnerText.textContent = localWon ? 'You Win!' : 'Opponent Wins!';
        this.elements.finalScore.textContent = `Final Score: ${p1Points} - ${p2Points}`;
    }
}

// Export
window.RiutizUI = RiutizUI;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RiutizUI };
}
