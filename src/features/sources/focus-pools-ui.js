import { AppState, saveContinuityConfig } from '../../core/state.js';
import { getFocusPools } from '../stats/continuity-engine.js';
import { showToast } from '../../core/utils.js';
import { t } from '../../core/i18n.js';

/* The limits, named once. They were each written twice - a literal in the
   condition and a digit in the sentence - so changing one changed only half of
   what the user is told. */
const MAX_FOCUS_POOLS = 3;
const MAX_POOL_QUESTIONS = 15;

export function showFocusPoolModal(targetOrArray) {
    if (!targetOrArray) return;
    const targets = Array.isArray(targetOrArray) ? targetOrArray : [targetOrArray];
    if (targets.length === 0) return;

    const overlay = document.getElementById('focusPoolOverlay');
    const desc = document.getElementById('focusPoolDesc');
    const countEl = document.getElementById('focusPoolCount');
    const warning = document.getElementById('focusPoolWarning');
    const removeBtn = document.getElementById('focusPoolRemoveBtn');
    
    if (!overlay || !AppState.continuityConfig) return;
    
    let pools = getFocusPools();
    // Default to the count of the first existing pool in the selection
    let existingPool = pools.find(p => targets.some(t => p.targetId === t.id && p.targetType === t.type));
    let count = existingPool ? existingPool.count : 3; // Default 3
    
    // Check if ALL selected targets are in the pool
    const allIncluded = targets.every(t => pools.some(p => p.targetId === t.id && p.targetType === t.type));

    const displayName = targets.length === 1 ? targets[0].name : t('bulk_selected', { count: targets.length }) || `${targets.length} sources`;
    desc.textContent = displayName;
    countEl.textContent = count;
    warning.style.display = 'none';
    
    if (allIncluded) {
        removeBtn.style.display = 'block';
    } else {
        removeBtn.style.display = 'none';
    }
    
    overlay.classList.add('active');
    
    const updateWarning = () => {
        const targetIds = targets.map(t => t.id);
        let totalOthers = pools.filter(p => !targetIds.includes(p.targetId)).reduce((sum, p) => sum + p.count, 0);
        let poolsCount = pools.filter(p => !targetIds.includes(p.targetId)).length + targets.length;
        
        if (poolsCount > MAX_FOCUS_POOLS) {
            warning.textContent = t('focus_pool_max_pools', { max: MAX_FOCUS_POOLS });
            warning.style.display = 'block';
            return false;
        }
        if (totalOthers + (count * targets.length) > MAX_POOL_QUESTIONS) {
            warning.textContent = t('focus_pool_max_total', { max: MAX_POOL_QUESTIONS });
            warning.style.display = 'block';
            return false;
        }
        warning.style.display = 'none';
        return true;
    };
    
    document.getElementById('focusPoolDecBtn').onclick = () => {
        if (count > 1) {
            count--;
            countEl.textContent = count;
            updateWarning();
        }
    };
    
    document.getElementById('focusPoolIncBtn').onclick = () => {
        if (count < 5) {
            count++;
            countEl.textContent = count;
            updateWarning();
        }
    };
    
    const closeActions = () => {
        overlay.classList.remove('active');
    };
    
    document.getElementById('focusPoolCancelBtn').onclick = closeActions;
    
    removeBtn.onclick = () => {
        const targetIds = targets.map(t => t.id);
        AppState.continuityConfig.focusPools = pools.filter(p => !targetIds.includes(p.targetId));
        saveContinuityConfig();
        showToast(t('focus_pool_removed'));
        closeActions();
    };
    
    document.getElementById('focusPoolSaveBtn').onclick = () => {
        if (!updateWarning()) return;
        
        targets.forEach(target => {
            const existing = AppState.continuityConfig.focusPools.find(p => p.targetId === target.id && p.targetType === target.type);
            if (existing) {
                existing.count = count;
            } else {
                AppState.continuityConfig.focusPools.push({ targetId: target.id, targetType: target.type, count: count });
            }
        });
        
        saveContinuityConfig();
        showToast(t('focus_pool_saved'));
        closeActions();
    };
}
