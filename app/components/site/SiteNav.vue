<script setup lang="ts">
const scrolled = ref(false)
const menuOpen = ref(false)
const menuToggle = ref<HTMLButtonElement | null>(null)
const active = ref('')
const links = [{ id: 'examples', label: 'Made with Vitrum' }, { id: 'how-it-works', label: 'How it works' }, { id: 'questions', label: 'Questions' }]
let observer: IntersectionObserver | null = null
function onScroll() { scrolled.value = window.scrollY > 24; if (window.scrollY < 200) active.value = '' }
function closeMenu() { menuOpen.value = false }
function onEscape() { if (menuOpen.value) { closeMenu(); menuToggle.value?.focus() } }
onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) active.value = entry.target.id
  }, { rootMargin: '-15% 0px -60% 0px' })
  links.forEach(link => { const section = document.getElementById(link.id); if (section) observer?.observe(section) })
})
onBeforeUnmount(() => { window.removeEventListener('scroll', onScroll); observer?.disconnect() })
</script>

<template>
  <header class="site-header" :class="{ scrolled, 'menu-open': menuOpen }" @keydown.esc="onEscape">
    <a class="skip-link" href="#main-content">Skip to content</a>
    <nav class="site-nav" aria-label="Main navigation">
      <NuxtLink to="/" class="site-brand" aria-label="Vitrum home" @click="closeMenu"><span class="brand-tile"><BrandMark :size="23" /></span><span>vitrum<span class="brand-period">.</span></span></NuxtLink>
      <div class="nav-links"><a v-for="link in links" :key="link.id" :href="`#${link.id}`" :class="{ active: active === link.id }" :aria-current="active === link.id ? 'location' : undefined">{{ link.label }}</a></div>
      <div class="nav-actions"><NuxtLink to="/studio" class="nav-cta">Open studio <span><Icon name="arrow-up-right" :size="15" /></span></NuxtLink><button ref="menuToggle" class="menu-toggle" :aria-expanded="menuOpen" aria-controls="mobile-navigation" :aria-label="menuOpen ? 'Close menu' : 'Open menu'" @click="menuOpen = !menuOpen"><Icon :name="menuOpen ? 'x' : 'menu'" :size="20" /></button></div>
    </nav>
    <div v-if="menuOpen" id="mobile-navigation" class="mobile-navigation"><a v-for="link in links" :key="link.id" :href="`#${link.id}`" @click="closeMenu">{{ link.label }}<Icon name="arrow-up-right" :size="16" /></a><p>A little less flat. A lot more you.</p></div>
  </header>
</template>

<style scoped>
.site-header { position: fixed; inset: max(16px, env(safe-area-inset-top)) 0 auto; z-index: 40; width: min(1320px, calc(100% - 112px)); margin-inline: auto; background: #ffffffb8; border: 1px solid #ffffffea; border-radius: 21px; backdrop-filter: blur(22px); box-shadow: 0 2px 3px #263b6703, 0 8px 32px #263b6706, inset 0 0 0 1px #ffffff80; transition: background 200ms, box-shadow 200ms; }
.site-header.scrolled { background: #ffffffed; box-shadow: 0 4px 8px #263b6704, 0 12px 40px #263b670e; }
.site-nav { height: 68px; padding: 0 13px 0 20px; display: flex; align-items: center; justify-content: space-between; gap: 25px; }
.site-brand { display: flex; align-items: center; gap: 10px; color: #202735; }
.brand-tile { width: 35px; height: 35px; display: grid; place-items: center; color: #3d65d9; background: linear-gradient(140deg,#fff,#e9eefb); border: 1px solid #fff; border-radius: 11px; box-shadow: 0 2px 5px #23448c0e, inset 0 -1px 2px #23448c0a; }
.site-brand > span:last-child { font-size: 26px; letter-spacing: -.065em; font-weight: 600; }
.brand-period { color: #3967e6; }
.nav-links { display: flex; gap: 5px; }
.nav-links a { display: flex; align-items: center; min-height: 38px; padding: 0 15px; border-radius: 12px; font-size: 12px; font-weight: 450; color: #646e7d; transition: color 160ms, background 160ms; }
.nav-links a:hover, .nav-links a.active { color: #263b67; background: #edf1f9; }
.nav-actions { display: flex; align-items: center; gap: 8px; }
.nav-cta { min-height: 43px; display: inline-flex; align-items: center; gap: 16px; padding: 0 7px 0 18px; border-radius: 13px; background: linear-gradient(180deg,#4778ef,#315fdd); border: 1px solid #2a58d2; box-shadow: inset 0 1px 0 #ffffff38, 0 2px 3px #244caa18; font-size: 12px; font-weight: 500; color: white; transition: box-shadow 180ms, transform 180ms; }
.nav-cta > span { width: 29px; height: 29px; display: grid; place-items: center; border-radius: 8px; background: #ffffff15; box-shadow: inset 0 0 0 1px #ffffff13; }
.nav-cta:hover { box-shadow: inset 0 1px 0 #ffffff38, 0 4px 14px #244caa30; transform: translateY(-1px); }
.nav-cta:active { transform: translateY(1px); }
.menu-toggle { display: none; width: 42px; height: 42px; align-items: center; justify-content: center; border-radius: 11px; color: #465574; background: #eff3fa; }
a:focus-visible, button:focus-visible { outline: 2px solid #2662df; outline-offset: 4px; }
.skip-link { position: absolute; left: 20px; top: -90px; padding: 12px; background: white; color: #20242c; border-radius: 8px; }
.skip-link:focus { top: 10px; z-index: 50; }
.mobile-navigation { display: none; }
@media (max-width: 1100px) { .site-header { width: calc(100% - 72px); } .nav-links a { padding-inline: 10px; font-size: 11px; } }
@media (max-width: 800px) { .site-header { width: calc(100% - 32px); inset-block-start: max(12px, env(safe-area-inset-top)); border-radius: 18px; } .site-nav { height: 62px; padding: 0 9px 0 13px; gap: 10px; } .nav-links { display: none; } .menu-toggle { display: flex; } .mobile-navigation { display: grid; padding: 9px 18px 17px; border-top: 1px solid #e9edf5; } .mobile-navigation a { padding-block: 15px; display: flex; justify-content: space-between; color: #394960; font-size: 14px; } .mobile-navigation p { font-size: 11px; color: #6c7686; padding-top: 10px; } }
@media (max-width: 400px) { .site-brand { gap: 7px; } .site-brand > span:last-child { font-size: 24px; } .nav-cta { padding-left: 12px; gap: 9px; font-size: 11px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none; } }
</style>
