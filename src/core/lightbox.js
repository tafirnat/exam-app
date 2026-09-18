export function initLightbox() {
    const overlay = document.getElementById('imageLightboxOverlay');
    const lightboxImg = document.getElementById('imageLightboxImg');
    const closeBtn = document.getElementById('imageLightboxClose');
    const scrollContainer = document.getElementById('imageLightboxScrollContainer');
    
    if (!overlay || !lightboxImg) return;

    let isZoomed = false;
    let scale = 1;
    let startX = 0, startY = 0;
    let translateX = 0, translateY = 0;
    let isDragging = false;

    // Her açılışta veya zoom kapanışında lightbox'u sıfırla
    const resetLightbox = () => {
        isZoomed = false;
        scale = 1;
        translateX = 0;
        translateY = 0;
        lightboxImg.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)';
        lightboxImg.style.transform = `translate(0px, 0px) scale(1)`;
        lightboxImg.classList.remove('zoomed');
    };

    // Lightbox'u aç
    const openLightbox = (src) => {
        lightboxImg.src = src;
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden'; // Arka plan kaydırmasını engelle
        resetLightbox();
    };

    // Lightbox'u kapat
    const closeLightbox = () => {
        overlay.classList.remove('active');
        document.body.style.overflow = '';
        setTimeout(() => {
            lightboxImg.src = '';
            resetLightbox();
        }, 300); // CSS opacity geçiş süresi ile aynı
    };

    // Sayfadaki görsellere tıklandığında Lightbox'u açmak için Event Delegation
    document.body.addEventListener('click', (e) => {
        const target = e.target;
        
        // Sadece img etiketlerini dinle
        if (target.tagName !== 'IMG' || !target.src) return;

        // Header, menü veya butonların içindeki küçük ikonları es geç
        if (target.closest('header') || 
            target.closest('.side-menu') || 
            target.closest('button') || 
            target.classList.contains('ai-icon-img') || 
            target.closest('.image-lightbox-overlay')) {
            return;
        }

        // Görsele tıklandığında lightbox aç
        openLightbox(target.src);
        e.preventDefault();
        e.stopPropagation();
    });

    // Kapatma butonu veya arka plan (overlay) tıklanınca lightbox'u kapat
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target === scrollContainer || e.target.closest('#imageLightboxClose')) {
            closeLightbox();
        }
    });

    // Lightbox içindeki görsele tıklandığında Zoom yap / Geri al
    lightboxImg.addEventListener('click', (e) => {
        e.stopPropagation();
        
        isZoomed = !isZoomed;
        lightboxImg.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)';
        
        if (isZoomed) {
            scale = 2.5; // Maksimum yakınlaştırma seviyesi
            lightboxImg.classList.add('zoomed');
            
            lightboxImg.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        } else {
            resetLightbox();
        }
    });

    // Mobilde ve Masaüstünde Sürükleyerek Gezinme (Pan)
    lightboxImg.addEventListener('pointerdown', (e) => {
        if (!isZoomed) return;
        isDragging = true;
        startX = e.clientX - translateX;
        startY = e.clientY - translateY;
        lightboxImg.style.transition = 'none'; // Sürüklerken animasyon olmamalı
        lightboxImg.setPointerCapture(e.pointerId);
        e.preventDefault(); // Varsayılan sürükleme davranışını iptal et
    });

    lightboxImg.addEventListener('pointermove', (e) => {
        if (!isDragging || !isZoomed) return;
        translateX = e.clientX - startX;
        translateY = e.clientY - startY;
        
        lightboxImg.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    });

    const stopDragging = (e) => {
        if (!isDragging) return;
        isDragging = false;
        lightboxImg.releasePointerCapture(e.pointerId);
    };

    lightboxImg.addEventListener('pointerup', stopDragging);
    lightboxImg.addEventListener('pointercancel', stopDragging);

    // ESC tuşuna basıldığında Lightbox'u kapat
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('active')) {
            closeLightbox();
        }
    });
}
