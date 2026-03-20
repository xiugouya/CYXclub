// CYX俱乐部 - JavaScript文件

// ====== 全局配置 ======
window.CYX_CONFIG = {
  wechat: 'fwCYXclub'   // 微信客服，修改这里全站生效
};

document.addEventListener('DOMContentLoaded', function() {
    // =====================
    // 滚动进度条
    // =====================
    const progressBar = document.createElement('div');
    progressBar.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        height: 3px;
        background: linear-gradient(90deg, var(--primary-color), var(--primary-light), var(--primary-color));
        z-index: 9999;
        transition: width 0.1s linear;
        pointer-events: none;
    `;
    document.body.appendChild(progressBar);

    window.addEventListener('scroll', () => {
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
        progressBar.style.width = progress + '%';
    });

    // =====================
    // 移动端菜单
    // =====================
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelector('.nav-links');
    
    if (hamburger) {
        hamburger.addEventListener('click', function() {
            navLinks.classList.toggle('active');
            hamburger.classList.toggle('active');
        });
    }

    // =====================
    // 平滑滚动
    // =====================
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                if (navLinks && navLinks.classList.contains('active')) {
                    navLinks.classList.remove('active');
                    if (hamburger) hamburger.classList.remove('active');
                }
            }
        });
    });

    // =====================
    // 导航栏背景
    // =====================
    const header = document.querySelector('header');
    if (header) {
        window.addEventListener('scroll', () => {
            header.style.background = window.scrollY > 50
                ? 'rgba(26, 26, 26, 0.98)'
                : 'rgba(26, 26, 26, 0.95)';
        });
    }

    // =====================
    // 卡片滚动入场动画
    // =====================
    const observerOptions = { threshold: 0.08, rootMargin: '0px 0px -50px 0px' };
    const staggerDelay = 120;

    const scrollObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry, i) => {
            if (entry.isIntersecting) {
                const el = entry.target;
                const siblings = Array.from(el.parentElement.children);
                const index = siblings.indexOf(el);
                setTimeout(() => {
                    el.style.opacity = '1';
                    el.style.transform = 'translateY(0) scale(1)';
                    el.classList.add('visible');
                }, index * staggerDelay);
                scrollObserver.unobserve(el);
            }
        });
    }, observerOptions);

    const animatedElements = document.querySelectorAll(
        '.game-card, .service-card, .news-card, .contact-card, ' +
        '.package-mini-card, .business-hours, .package-card, .news-item'
    );
    
    animatedElements.forEach((el) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(28px) scale(0.97)';
        el.style.transition = 'opacity 0.65s cubic-bezier(0.22, 1, 0.36, 1), ' +
            'transform 0.65s cubic-bezier(0.22, 1, 0.36, 1), ' +
            'box-shadow 0.3s ease, border-color 0.3s ease';
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0) scale(1)';
        } else {
            scrollObserver.observe(el);
        }
    });

    // =====================
    // 段落标题动画
    // =====================
    const sectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const el = entry.target;
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
                sectionObserver.unobserve(el);
            }
        });
    }, { threshold: 0.15 });

    document.querySelectorAll('.section-title, .section-subtitle').forEach((el, i) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = `opacity 0.6s ease ${i * 0.1}s, transform 0.6s ease ${i * 0.1}s`;
        sectionObserver.observe(el);
    });

    // =====================
    // 鼠标视差（桌面端）
    // =====================
    if (window.innerWidth > 768) {
        const hero = document.querySelector('.hero');
        const heroDecoration = document.querySelector('.hero-rings');
        const particles = document.querySelector('.hero-particles');
        
        if (hero) {
            hero.addEventListener('mousemove', (e) => {
                const rect = hero.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width - 0.5;
                const y = (e.clientY - rect.top) / rect.height - 0.5;
                if (heroDecoration) {
                    heroDecoration.style.transform = `translate(${x * 30}px, ${y * 20}px)`;
                    heroDecoration.style.transition = 'none';
                }
                if (particles) {
                    particles.style.transform = `translate(${x * -15}px, ${y * -10}px)`;
                    particles.style.transition = 'none';
                }
            });
            
            hero.addEventListener('mouseleave', () => {
                if (heroDecoration) {
                    heroDecoration.style.transform = 'translate(0, 0)';
                    heroDecoration.style.transition = 'transform 0.6s ease';
                }
                if (particles) {
                    particles.style.transform = 'translate(0, 0)';
                    particles.style.transition = 'transform 0.6s ease';
                }
            });
        }
    }

    // =====================
    // 游戏卡片图标弹跳
    // =====================
    document.querySelectorAll('.game-card').forEach(card => {
        card.addEventListener('mouseenter', () => {
            const icon = card.querySelector('.game-icon');
            if (icon) {
                icon.style.animation = 'bounceIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
            }
        });
        card.addEventListener('mouseleave', () => {
            const icon = card.querySelector('.game-icon');
            if (icon) {
                icon.style.animation = '';
            }
        });
    });

    // ====== 全局配置：统一填充各页面硬编码内容 ======
    const cfg = window.CYX_CONFIG || { wechat: 'fwCYXclub' };

    // 微信客服（services.html）
    const elWechat = document.getElementById('cf-wechat');
    if (elWechat) elWechat.textContent = cfg.wechat;
    const elWechatNotice = document.getElementById('cf-wechat-notice');
    if (elWechatNotice) elWechatNotice.textContent = cfg.wechat;

    // 微信客服（index.html）
    const elWechatIndex = document.getElementById('cf-wechat-index');
    if (elWechatIndex) elWechatIndex.textContent = cfg.wechat;
});
