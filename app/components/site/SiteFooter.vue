<template>
  <footer class="site-footer">
    <div class="footer-inner">
      <div class="footer-top"><div class="footer-intro"><span class="footer-symbol"><BrandMark :size="24" /></span><p>A little less flat.<br>A lot more you.</p></div><div class="footer-column"><h2>Find your inspiration</h2><a href="#examples">The collection</a><a href="#how-it-works">How it works</a><a href="#questions">Good to know</a></div><div class="footer-column"><h2>Make it your own</h2><NuxtLink to="/studio">Open the studio <Icon name="arrow-up-right" :size="13" /></NuxtLink><NuxtLink to="/studio?sample=camera&finish=sapphire">Start with an icon</NuxtLink><span>PNG, GLB & STL exports</span></div></div>
      <div class="footer-wordmark"><span>vitrum<span class="wordmark-dot">.</span></span><a href="#main-content" class="back-to-top" aria-label="Back to top"><Icon name="arrow-up" :size="24" /></a></div>
      <div class="footer-bottom"><span><Icon name="lock" :size="13" /> Made on your device. Yours to keep.</span><span>For the joy of making.</span></div>
    </div>
  </footer>
</template>

<style scoped>
.site-footer { position: relative; overflow: hidden; background: linear-gradient(155deg,#edf1fa 0%,#e8edf8 58%,#e5eafa 100%); color: #57647a; padding-bottom: env(safe-area-inset-bottom); }
.site-footer::before { content: ''; position: absolute; width: 500px; height: 500px; right: -150px; top: 50px; background: radial-gradient(circle,#d8e3ff85,transparent 65%); pointer-events: none; }
.footer-inner { position: relative; width: min(1320px, calc(100% - 112px)); margin-inline: auto; }
.footer-top { padding-top: 57px; display: grid; grid-template-columns: 1.6fr 1fr 1fr; gap: 40px; }
.footer-intro { display: flex; align-items: start; gap: 20px; }
.footer-symbol { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 15px; color: #3c63cc; border: 1px solid white; background: linear-gradient(140deg,#fff,#e6ecfa); box-shadow: 0 5px 12px #233f7c08, inset 0 1px 1px white; }
.footer-intro p { font-size: 24px; font-weight: 500; line-height: 1.18; letter-spacing: -.05em; color: #394963; margin-top: 1px; }
.footer-column { display: flex; flex-direction: column; align-items: start; gap: 13px; font-size: 12px; }
.footer-column h2 { font-size: 11px; font-weight: 500; color: #354666; margin-bottom: 6px; }
.footer-column a { display: inline-flex; align-items: center; gap: 7px; transition: color 150ms; }
.footer-column a:hover { color: #315fdb; }
.footer-column > span { color: #5e6c83; font-size: 11px; }
.footer-wordmark { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin: 32px 0 23px; }
.footer-wordmark > span { font-size: clamp(100px,20.5vw,290px); font-weight: 550; letter-spacing: -.085em; line-height: 1; color: #354467; }
.wordmark-dot { color: #416ede; }
.back-to-top { display: grid; place-items: center; width: 61px; height: 61px; border-radius: 50%; color: #4864a0; border: 1px solid #ffffffd9; background: #ffffff70; box-shadow: 0 3px 8px #24447705, inset 0 1px 0 white; transition: transform 180ms, background 180ms; margin-top: 60px; }
.back-to-top:hover { transform: translateY(-4px); background: white; }
.footer-bottom { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-block: 22px 29px; border-top: 1px solid #5369931b; color: #5d6b82; font-size: 11px; }
.footer-bottom > span:first-child { display: flex; align-items: center; gap: 7px; }
a:focus-visible { outline: 2px solid #2662df; outline-offset: 5px; border-radius: 3px; }
@media (max-width: 1100px) { .footer-inner { width: calc(100% - 72px); } .footer-top { grid-template-columns: 1.2fr 1fr 1fr; gap: 25px; } .footer-intro { gap: 12px; } .footer-intro p { font-size: 22px; } }
@media (max-width: 800px) { .footer-inner { width: calc(100% - 44px); } .footer-top { grid-template-columns: 1fr 1fr; padding-top: 37px; gap: 32px 20px; } .footer-intro { grid-column: 1 / -1; } .footer-wordmark { margin-block: 28px 18px; } .footer-wordmark > span { font-size: 22vw; } .back-to-top { width: 44px; height: 44px; margin-top: 25px; flex-shrink: 0; } .footer-bottom { font-size: 10px; flex-wrap: wrap; gap: 10px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none; } }
</style>
