// CYX俱乐部 - JavaScript文件

document.addEventListener('DOMContentLoaded', function() {
    // 移动端菜单切换
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelector('.nav-links');
    
    if (hamburger) {
        hamburger.addEventListener('click', function() {
            navLinks.classList.toggle('active');
            
            // 汉堡包动画
            const spans = hamburger.querySelectorAll('span');
            spans[0].classList.toggle('rotate-1');
            spans[1].classList.toggle('hide');
            spans[2].classList.toggle('rotate-2');
        });
    }

    // 平滑滚动
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
                // 移动端点击后关闭菜单
                if (navLinks.classList.contains('active')) {
                    navLinks.classList.remove('active');
                }
            }
        });
    });

    // 滚动时导航栏背景变化
    const header = document.querySelector('header');
    window.addEventListener('scroll', function() {
        if (window.scrollY > 50) {
            header.style.background = 'rgba(26, 26, 26, 0.98)';
        } else {
            header.style.background = 'rgba(26, 26, 26, 0.95)';
        }
    });

    // 卡片悬停效果增强
    const cards = document.querySelectorAll('.game-card, .service-card, .news-card, .contact-card');
    cards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transition = 'all 0.3s ease';
        });
    });

    // 数字动画效果 (可选)
    const animateNumbers = () => {
        const numbers = document.querySelectorAll('.stat-number');
        numbers.forEach(num => {
            const target = parseInt(num.getAttribute('data-target'));
            const duration = 2000;
            const step = target / (duration / 16);
            let current = 0;
            
            const timer = setInterval(() => {
                current += step;
                if (current >= target) {
                    current = target;
                    clearInterval(timer);
                }
                num.textContent = Math.floor(current);
            }, 16);
        });
    };

    // Intersection Observer for 动画
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-in');
            }
        });
    }, observerOptions);

    document.querySelectorAll('.game-card, .service-card, .news-card').forEach(el => {
        observer.observe(el);
    });
});
