import { AppState, saveContinuityConfig } from '../../core/state.js';
import { getFocusPools } from '../stats/continuity-engine.js';
import { showToast } from '../../core/utils.js';

export function showFocusPoolModal(target) {
    const overlay = document.getElementById('focusPoolOverlay');
    const desc = document.getElementById('focusPoolDesc');
    const countEl = document.getElementById('focusPoolCount');
    const warning = document.getElementById('focusPoolWarning');
    const removeBtn = document.getElementById('focusPoolRemoveBtn');
    
    if (!overlay || !AppState.continuityConfig) return;
    
    let pools = getFocusPools();
    let existingPool = pools.find(p => p.targetId === target.id && p.targetType === target.type);
    let count = existingPool ? existingPool.count : 3; // Default 3
    
    desc.textContent = target.name;
    countEl.textContent = count;
    warning.style.display = 'none';
    
    if (existingPool) {
        removeBtn.style.display = 'block';
    } else {
        removeBtn.style.display = 'none';
    }
    
    overlay.classList.add('active');
    
    const updateWarning = () => {
        let totalOthers = pools.filter(p => p.targetId !== target.id).reduce((sum, p) => sum + p.count, 0);
        let poolsCount = pools.filter(p => p.targetId !== target.id).length + 1;
        
        if (poolsCount > 3) {
            warning.textContent = "Maksimum 3 farklı odak havuzu seçebilirsiniz.";
            warning.style.display = 'block';
            return false;
        }
        if (totalOthers + count > 15) {
            warning.textContent = "Tüm havuzların toplamı 15 soruyu geçemez.";
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
        AppState.continuityConfig.focusPools = pools.filter(p => p.targetId !== target.id);
        saveContinuityConfig();
        showToast("Odak havuzu kaldırıldı.");
        closeActions();
    };
    
    document.getElementById('focusPoolSaveBtn').onclick = () => {
        if (!updateWarning()) return;
        
        const newPool = { targetId: target.id, targetType: target.type, count: count };
        
        if (existingPool) {
            existingPool.count = count;
        } else {
            AppState.continuityConfig.focusPools.push(newPool);
        }
        saveContinuityConfig();
        showToast("Odak havuzu güncellendi.");
        closeActions();
    };
}
