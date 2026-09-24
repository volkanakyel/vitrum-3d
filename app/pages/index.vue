<script setup lang="ts">
import { LANDING_EXAMPLES, LANDING_FAQS, landingLooks } from '~/data/landing'

const route = useRoute()
const siteUrl = useRuntimeConfig().public.siteUrl
const socialImage = siteUrl ? new URL('/images/vitrum-social.png', siteUrl).href : '/images/vitrum-social.png'
const looks = landingLooks()
const preset = ref('sapphire')
const currentLook = computed(() => looks.find(p => p.id === preset.value)!)
const live = ref(false)
const unavailable = ref(false)
const paused = ref(false)
const shareStatus = ref('')
const shareUrl = ref('')
let statusTimer: ReturnType<typeof setTimeout> | undefined
const studioLink = computed(() => ({ path: '/studio', query: { sample: 'camera', finish: preset.value } }))
const examples = LANDING_EXAMPLES
const faqs = LANDING_FAQS

useSeoMeta({
  title: 'Vitrum — Less flat. More feeling.',
  description: 'Give your icons, logos and artwork a new dimension. Create beautiful 3D in glass, metal and colour, right in your browser. Free to create. No sign-up.',
  ogTitle: 'Less flat. More feeling. — Vitrum',
  ogDescription: 'Everyday shapes. Extraordinary character. Turn your icons and logos into glass, metal and colour with Vitrum.',
  ogType: 'website',
  ogImage: socialImage,
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageAlt: 'Vitrum: Less flat. More feeling. A collection of sculptural glass camera, conversation, heart and sparkle icons.',
  twitterCard: 'summary_large_image',
  twitterTitle: 'Less flat. More feeling. — Vitrum',
  twitterDescription: 'Beautiful 3D from your logo or icon. Made in your browser.',
  twitterImage: socialImage,
})

function selectLook(id: string) {
  preset.value = id
  shareStatus.value = ''
  shareUrl.value = ''
}

function restoreFinish(value: unknown) {
  preset.value = typeof value === 'string' && looks.some(look => look.id === value) ? value : 'sapphire'
}

// Nuxt restores a prerendered page's query after suspense resolves, later than mounted.
// Read the final URL once that restoration has completed; keep later navigations reactive.
onNuxtReady(() => restoreFinish(new URLSearchParams(window.location.search).get('finish')))
watch(() => route.query.finish, restoreFinish)

async function shareLook() {
  const url = new URL('/', window.location.origin)
  url.searchParams.set('finish', preset.value)
  const data = { title: 'Vitrum — Less flat. More feeling.', text: `A little ${currentLook.value.label.toLowerCase()}. A lot of personality. Made with Vitrum.`, url: url.href }
  try {
    if (navigator.share) {
      await navigator.share(data)
      shareStatus.value = 'Shared'
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url.href)
      shareStatus.value = 'Link copied'
    } else {
      shareUrl.value = url.href
      shareStatus.value = 'Copy the link below'
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return
    shareUrl.value = url.href
    shareStatus.value = 'Copy the link below'
  }
  clearTimeout(statusTimer)
  statusTimer = setTimeout(() => { shareStatus.value = '' }, 5000)
}

onBeforeUnmount(() => clearTimeout(statusTimer))
</script>

<template>
  <main id="main-content" class="landing">
    <section class="hero frame" aria-labelledby="hero-title">
      <div class="hero-copy">
        <p class="intro"><span class="intro-symbol" aria-hidden="true">✳</span> The playful side of 3D</p>
        <h1 id="hero-title">Less flat.<br>More<br><span>feeling.</span></h1>
        <p class="hero-description">Give your icons, logos and ideas a whole new feel. Turn flat artwork into beautiful 3D, with glass, metal and a little imagination.</p>
        <div class="hero-actions">
          <NuxtLink to="/studio" class="action action-primary">Open studio <span class="action-icon"><Icon name="arrow-up-right" :size="18" /></span></NuxtLink>
          <a href="#examples" class="action action-text">Get inspired <Icon name="arrow-down" :size="16" /></a>
        </div>
        <p class="hero-reassurance"><span><Icon name="check" :size="13" /> Free to create</span><span><Icon name="check" :size="13" /> No sign-up</span></p>
      </div>

      <div class="hero-work">
        <div class="hero-stage">
          <LandingScene :preset="preset" :paused="paused" @ready="live = true" @unavailable="unavailable = true; live = false" />
          <div class="stage-topline"><span class="stage-status"><span :class="{ live }" />{{ live ? 'A little glass. A lot of character.' : unavailable ? 'Made with Vitrum' : 'Meet your next inspiration' }}</span><button v-if="live" class="motion-toggle" :aria-label="paused ? 'Play 3D animation' : 'Pause 3D animation'" :aria-pressed="paused" @click="paused = !paused"><Icon :name="paused ? 'play' : 'pause'" :size="14" /></button></div>
          <div class="collection-tag"><span>01—04</span> The everyday collection</div>
          <div class="stage-caption"><span><Icon name="move3d" :size="15" /> Made in Vitrum. Ready to make yours.</span><span class="stage-live">{{ live ? 'LIVE 3D' : '3D STUDIES' }}</span></div>
        </div>
        <div class="material-bar">
          <div class="material-title"><span>Try a different feeling</span><strong aria-live="polite">{{ currentLook.label }}</strong></div>
          <div class="material-options" role="group" aria-label="Preview a material">
            <button v-for="look in looks" :key="look.id" class="material-swatch" :class="{ selected: preset === look.id }" :aria-label="look.label" :aria-pressed="preset === look.id" :title="look.label" :disabled="unavailable" @click="selectLook(look.id)"><span :style="{ background: look.swatch }" /></button>
          </div>
          <NuxtLink :to="studioLink" class="edit-example" aria-label="Open this design in the studio"><Icon name="arrow-up-right" :size="20" /></NuxtLink>
        </div>
      </div>
    </section>

    <div class="possibilities frame"><span>A new dimension for your next big idea.</span><div><span><i aria-hidden="true">↗</i> Brand identities</span><span><i aria-hidden="true">✳</i> Launch visuals</span><span><i aria-hidden="true">♡</i> Social moments</span><span><i aria-hidden="true">◇</i> Real-world objects</span></div></div>

    <section id="examples" class="examples-section frame" aria-labelledby="examples-title">
      <div class="section-heading"><div><p class="section-kicker">The inspiration shelf</p><h2 id="examples-title">Everyday shapes.<br>Extraordinary character.</h2></div><p>Good design makes you feel something.<br>Pick a favourite. Put your own spin on it.</p></div>
      <div class="example-grid">
        <NuxtLink v-for="example in examples" :key="example.id" :to="{ path: '/studio', query: { sample: example.id, finish: example.preset } }" class="example-card" :aria-label="example.label">
          <div class="example-art" :class="example.tone"><img :src="`/images/${example.image}.webp`" :alt="example.alt" width="720" height="720" loading="lazy" decoding="async"><span class="example-material">{{ example.material }}</span><span class="example-open"><Icon name="arrow-up-right" :size="18" /></span></div>
          <div class="example-text"><h3>{{ example.name }}</h3><p>{{ example.type }}</p></div>
        </NuxtLink>
      </div>
    </section>

    <section id="how-it-works" class="process-section frame" aria-labelledby="process-title">
      <div class="process-intro"><p class="section-kicker">Your creative shortcut</p><h2 id="process-title">From “what if”<br>to “look at this.”</h2><p>You don’t need to be a 3D artist.<br>Bring an idea. We’ll help it take shape.</p><NuxtLink to="/studio" class="action action-dark">Make something yours <span class="action-icon"><Icon name="arrow-up-right" :size="17" /></span></NuxtLink></div>
      <div class="steps">
        <div class="step"><span class="step-number">01</span><div><h3>Start with a spark.</h3><p>Drop in your logo, icon or favourite doodle. PNG, JPG, WebP or SVG. Or try one of ours.</p></div><Icon name="imagePlus" :size="23" /></div>
        <div class="step"><span class="step-number">02</span><div><h3>Find its personality.</h3><p>Liquid glass or polished metal? Choose a finish, dial in the depth, and find your favourite angle.</p></div><Icon name="sliders" :size="23" /></div>
        <div class="step"><span class="step-number">03</span><div><h3>Let it out into the world.</h3><p>Drop it into a pitch, a website or your next post. Export an image, a 3D model or an STL for fabrication.</p><div class="export-types"><span>PNG <small>Image</small></span><span>GLB <small>3D model</small></span><span>STL <small>Fabrication</small></span></div></div><Icon name="download" :size="23" /></div>
      </div>
    </section>

    <section class="closing-section frame" aria-labelledby="closing-title">
      <div class="closing-art" aria-hidden="true"><img src="/images/gold.webp" width="720" height="720" alt="" loading="lazy" decoding="async"></div>
      <div class="closing-copy"><p class="section-kicker">Go on. Follow that idea.</p><h2 id="closing-title">Make something<br>worth a second look.</h2><p>The logo in your folder. The sketch on your desk. There’s another side to it. Let’s find it.</p><div class="closing-actions"><NuxtLink to="/studio" class="action action-dark">Find your dimension <span class="action-icon"><Icon name="arrow-up-right" :size="17" /></span></NuxtLink><button class="share-button" @click="shareLook"><Icon name="share" :size="17" /> Share Vitrum</button></div><p v-if="shareStatus" class="share-status" role="status">{{ shareStatus }}</p><label v-if="shareUrl" class="share-fallback">Share this link<input :value="shareUrl" readonly @focus="($event.target as HTMLInputElement).select()"></label></div>
    </section>

    <section id="questions" class="faq-section frame" aria-labelledby="faq-title"><div><p class="section-kicker">Before you jump in</p><h2 id="faq-title">Good questions.</h2></div><div class="faq-items"><details v-for="faq in faqs" :key="faq.question"><summary>{{ faq.question }}<Icon name="plus" :size="17" /></summary><p>{{ faq.answer }}</p></details></div></section>
  </main>
</template>

<style scoped>
.landing { --paper: #f8f9fc; --text: #20242c; --subtle: #656b75; --blue: #2662df; background: var(--paper); color: var(--text); overflow: clip; }
.hero { display: grid; grid-template-columns: 1fr 1.06fr; align-items: center; gap: 60px; padding-top: 150px; padding-bottom: 62px; }
.hero-copy { padding: 0 0 16px; }
.intro { display: flex; align-items: center; gap: 9px; font-size: 12px; font-weight: 500; margin-bottom: 26px; color: #545c69; }
.intro-symbol { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; background: #e9edff; border: 1px solid #dce4ff; border-radius: 10px; color: #4b6deb; font-size: 24px; line-height: 1; transform: rotate(-8deg); }
h1 { margin: 0; font-weight: 500; font-size: clamp(68px, 7.4vw, 108px); line-height: .97; letter-spacing: -.075em; }
h1 > span { color: #516de1; }
.hero-description { max-width: 380px; margin: 26px 0 0; font-size: 16px; line-height: 1.7; color: var(--subtle); letter-spacing: -.015em; }
.hero-actions { display: flex; align-items: center; gap: 12px; margin-top: 28px; }
.action { display: inline-flex; align-items: center; justify-content: center; gap: 23px; min-height: 52px; padding: 0 18px; border: 1px solid transparent; border-radius: 15px; font-size: 13px; font-weight: 500; text-decoration: none; transition: background 180ms, transform 180ms, box-shadow 180ms; }
.action-icon { display: grid; place-items: center; width: 32px; height: 32px; margin-right: -9px; border-radius: 10px; background: #ffffff1a; border: 1px solid #ffffff17; transition: transform 180ms; }
.action-primary { color: white; border-color: #345cde; background: linear-gradient(155deg, #6582f9, #3c5edb 72%); box-shadow: inset 0 1px 0 #ffffff38, 0 4px 8px #254cbf19, 0 1px 2px #1c3c9829; }
.action-primary:hover { transform: translateY(-2px); box-shadow: inset 0 1px 0 #ffffff38, 0 7px 18px #254cbf2a; }
.action-dark { color: white; background: linear-gradient(150deg, #464d5b, #252b36); box-shadow: inset 0 1px 0 #ffffff26, 0 3px 6px #18223d12; }
.action-dark:hover { transform: translateY(-2px); box-shadow: 0 6px 15px #18223d25; }
.action-text { color: #505969; gap: 16px; background: #ffffff9c; border-color: #e3e7ef; box-shadow: 0 2px 3px #23305003, inset 0 1px 0 white; }
.action-text:hover { background: white; transform: translateY(-2px); box-shadow: 0 5px 12px #23305009; }
.action:hover .action-icon { transform: rotate(7deg); }
.action:active { transform: scale(.98); }
.hero-reassurance { display: flex; gap: 22px; margin-top: 18px; color: #697180; font-size: 11px; }
.hero-reassurance span { display: inline-flex; align-items: center; gap: 5px; }
.hero-work { min-width: 0; position: relative; }
.hero-stage { position: relative; height: clamp(450px, 41vw, 600px); border: 1px solid #e4e8f3; box-shadow: 0 10px 40px #344e9a05, inset 0 0 0 1px white; border-radius: 28px; overflow: hidden; background: #e9edf4; isolation: isolate; }
.stage-topline { position: absolute; top: 22px; left: 23px; right: 21px; display: flex; align-items: center; justify-content: space-between; }
.stage-status { display: flex; align-items: center; gap: 7px; color: #656f80; font-size: 10px; }
.stage-status > span { width: 5px; height: 5px; background: #8c97a5; border-radius: 50%; }
.stage-status > span.live { background: #387969; box-shadow: 0 0 0 3px #3879690f; }
.motion-toggle { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 12px; border: 1px solid #ffffffa8; background: #ffffff7a; color: #627088; transition: background 180ms; }
.motion-toggle:hover { background: white; }
.collection-tag { position: absolute; left: 25px; bottom: 66px; display: flex; gap: 8px; align-items: center; padding: 8px 11px; border: 1px solid #ffffffb3; background: #ffffff80; backdrop-filter: blur(12px); border-radius: 9px; color: #5c6681; font-size: 10px; box-shadow: 0 3px 10px #40486b05; }
.collection-tag > span { color: #626f83; font-size: 9px; }
.stage-caption { position: absolute; bottom: 23px; left: 25px; right: 25px; display: flex; align-items: center; justify-content: space-between; color: #5e6b82; font-size: 10px; }
.stage-caption > span:first-child { display: inline-flex; align-items: center; gap: 7px; }
.stage-live { font-size: 8px; letter-spacing: .13em; }
.material-bar { display: flex; align-items: center; gap: 18px; padding: 19px 8px 0; }
.material-title { margin-right: auto; font-size: 10px; color: var(--subtle); }
.material-title strong { display: block; font-size: 12px; font-weight: 500; color: #39424f; margin-top: 2px; }
.material-options { display: flex; align-items: center; gap: 5px; }
.material-swatch { width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid transparent; border-radius: 50%; background: none; transition: border-color 150ms; }
.material-swatch > span { width: 24px; height: 24px; border-radius: 50%; box-shadow: inset 0 1px 2px #ffffff66, inset 0 -2px 3px #00000020, 0 2px 4px #25335c0c; transition: transform 180ms; }
.material-swatch.selected { border-color: #6679b4; box-shadow: 0 0 0 3px #e9edfa; }
.material-swatch:hover > span { transform: scale(1.09); }
.material-swatch:hover { border-color: #b6becb; }
.material-swatch:disabled { opacity: .4; cursor: default; }
.edit-example { display: grid; place-items: center; height: 36px; width: 36px; border: 1px solid #e0e5ef; border-radius: 12px; margin-left: 2px; color: #526184; background: white; transition: background 180ms, transform 180ms; }
.edit-example:hover { background: #e9edff; transform: translateY(-2px); }
.possibilities { border-top: 1px solid #dde1e7; border-bottom: 1px solid #dde1e7; display: flex; align-items: center; justify-content: space-between; gap: 30px; padding-block: 27px; font-size: 11px; }
.possibilities > span { color: #697180; max-width: 190px; line-height: 1.6; }
.possibilities > div > span { display: inline-flex; align-items: center; gap: 9px; }
.possibilities i { font-style: normal; color: #7488c5; font-size: 19px; font-weight: 400; }
.possibilities > div { display: flex; gap: clamp(20px, 3vw, 55px); font-weight: 500; color: #555e6a; }
.examples-section { padding-top: 105px; }
.section-heading { display: flex; justify-content: space-between; align-items: end; gap: 30px; margin-bottom: 38px; }
.section-kicker { font-size: 11px; font-weight: 500; color: #626d7e; margin: 0 0 15px; }
h2 { font-size: clamp(34px, 3.7vw, 53px); font-weight: 500; line-height: 1.08; letter-spacing: -.06em; margin: 0; }
.section-heading > p { color: var(--subtle); font-size: 13px; line-height: 1.7; margin: 0 0 3px; }
.example-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; }
.example-card { text-decoration: none; min-width: 0; }
.example-art { position: relative; aspect-ratio: 1 / 1.05; overflow: hidden; border-radius: 23px; border: 1px solid #e4e8f3; background: #e8edf5; }
.example-art img { width: 100%; height: 100%; object-fit: cover; transition: transform 500ms cubic-bezier(.2,.65,.3,1); }
.example-art.blue { background: #e8edf7; }
.example-art.silver { background: #ebedf0; }
.example-art.pink { background: #f3e9ee; }
.example-material { position: absolute; bottom: 20px; left: 20px; font-size: 10px; color: #5a6678; background: #ffffff91; border: 1px solid #ffffffb8; backdrop-filter: blur(8px); padding: 6px 9px; border-radius: 8px; }
.example-open { position: absolute; right: 16px; bottom: 15px; width: 35px; height: 35px; border-radius: 12px; border: 1px solid #ffffffb8; background: #ffffff90; display: grid; place-items: center; color: #546074; transition: background 180ms; }
.example-text { padding: 18px 1px; }
.example-text h3 { font-weight: 500; font-size: 16px; letter-spacing: -.03em; }
.example-text p { font-size: 11px; color: #697180; margin-top: 5px; }
.process-section { display: grid; grid-template-columns: 1fr 1fr; gap: 85px; padding-block: 115px 105px; }
.process-intro h2 { font-size: clamp(32px, 3.3vw, 47px); }
.process-intro > p:not(.section-kicker) { margin-top: 22px; color: var(--subtle); line-height: 1.8; font-size: 13px; }
.process-intro .action { margin-top: 25px; }
.step { display: grid; grid-template-columns: 25px 1fr 24px; gap: 15px; border-top: 1px solid #dfe3e9; padding: 22px 0 25px; }
.step-number { font-size: 10px; color: #5069af; padding-top: 5px; }
.step h3 { font-size: 17px; font-weight: 500; letter-spacing: -.035em; }
.step p { color: var(--subtle); font-size: 12px; line-height: 1.8; margin-top: 8px; max-width: 340px; }
.step > svg { color: #68778e; margin-top: 3px; }
.export-types { display: flex; gap: 8px; margin-top: 15px; }
.export-types > span { display: flex; flex-direction: column; gap: 3px; background: linear-gradient(140deg, #f1f3f9, #e9edf6); border: 1px solid #e2e7f1; border-radius: 9px; padding: 8px 12px; font-size: 10px; font-weight: 600; }
.export-types small { color: #606d83; font-size: 9px; font-weight: 400; }
.closing-section { position: relative; display: grid; grid-template-columns: .85fr 1fr; gap: 30px; align-items: center; background: linear-gradient(125deg, #eef1fb, #e9eefa 58%, #eae7f5); border: 1px solid #e1e6f2; border-radius: 28px; overflow: hidden; min-height: 398px; }
.closing-art { align-self: stretch; min-width: 0; position: relative; }
.closing-art img { width: 100%; height: 100%; position: absolute; object-fit: cover; mix-blend-mode: multiply; }
.closing-copy { padding: 55px 40px 55px 0; position: relative; }
.closing-copy h2 { font-size: clamp(34px, 3.5vw, 50px); }
.closing-copy > p:not(.section-kicker):not(.share-status) { margin-top: 20px; max-width: 340px; color: #5f6b7e; line-height: 1.7; font-size: 13px; }
.closing-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 22px; margin-top: 27px; }
.share-button { display: inline-flex; align-items: center; gap: 7px; min-height: 44px; padding: 0 13px; border: 1px solid #dce2f0; background: #ffffff5e; border-radius: 12px; font-size: 11px; color: #5a6576; transition: background 180ms; }
.share-button:hover { color: #20242c; background: #ffffffc2; }
.share-status { color: #315e51; font-size: 12px; margin-top: 12px; }
.share-fallback { display: block; margin-top: 12px; font-size: 12px; }
.share-fallback input { display: block; padding: 10px; margin-top: 6px; border: 1px solid #afb7c4; background: white; width: 100%; border-radius: 5px; }
.faq-section { display: grid; grid-template-columns: 1fr 1.2fr; gap: 65px; padding-block: 105px 100px; }
.faq-section h2 { font-size: 38px; }
.faq-items details { border-bottom: 1px solid #dfe3e9; }
.faq-items details:first-child { border-top: 1px solid #dfe3e9; }
.faq-items summary { display: flex; align-items: center; justify-content: space-between; gap: 20px; list-style: none; padding: 22px 0; font-size: 13px; font-weight: 500; cursor: pointer; }
.faq-items summary::-webkit-details-marker { display: none; }
.faq-items summary > svg { flex-shrink: 0; color: #67788a; transition: transform 180ms; }
.faq-items details[open] summary > svg { transform: rotate(45deg); }
.faq-items details > p { font-size: 12px; line-height: 1.8; color: var(--subtle); max-width: 520px; padding-bottom: 22px; }
:where(a, button, summary, input):focus-visible { outline: 2px solid var(--blue); outline-offset: 5px; }
:where(section)[id] { scroll-margin-top: 110px; }
@media (hover: hover) and (pointer: fine) { .example-card:hover .example-art img { transform: scale(1.045); } .example-card:hover .example-open { background: white; } }
@media (min-width: 1600px) { .hero { padding-top: 160px; padding-bottom: 80px; gap: 65px; } }
@media (max-width: 1100px) { .hero { gap: 30px; padding-top: 120px; } h1 { font-size: clamp(65px, 8vw, 88px); } .hero-stage { height: 450px; } .hero-description { font-size: 14px; } .hero-actions { gap: 8px; } .action { padding-inline: 16px; gap: 12px; font-size: 12px; } .material-bar { gap: 10px; } .process-section { gap: 45px; } .possibilities > div { gap: 20px; } }
@media (max-width: 800px) { .hero { gap: 27px; grid-template-columns: 1fr; padding-top: 116px; padding-bottom: 38px; } .hero-copy { padding: 0; } .intro { margin-bottom: 20px; } h1 { font-size: clamp(64px, 12vw, 92px); line-height: .98; } h1 br:nth-of-type(2) { display: none; } h1 > span::before { content: " "; } .hero-description { max-width: 430px; font-size: 15px; margin-top: 22px; } .hero-actions { margin-top: 22px; gap: 10px; } .action { font-size: 13px; padding-inline: 18px; } .hero-reassurance { margin-top: 15px; } .hero-stage { height: auto; aspect-ratio: 1.1; } .material-bar { padding-top: 15px; } .possibilities { display: block; padding-block: 22px; } .possibilities > span { max-width: none; } .possibilities > div { margin-top: 14px; flex-wrap: wrap; gap: 9px 25px; font-size: 10px; } .examples-section { padding-top: 66px; } .section-heading { align-items: start; margin-bottom: 25px; gap: 20px; } h2 { font-size: 37px; } .section-heading > p { max-width: 200px; font-size: 12px; } .example-grid { gap: 12px; } .example-art { aspect-ratio: 1 / 1.2; } .example-material { left: 12px; bottom: 15px; font-size: 9px; } .example-open { display: none; } .example-text h3 { font-size: 13px; } .example-text p { font-size: 10px; } .process-section { padding-block: 65px; gap: 30px; grid-template-columns: 1fr; } .process-intro h2 { font-size: 37px; } .steps { margin-top: 12px; } .step p { max-width: 460px; } .closing-section { gap: 0; grid-template-columns: .65fr 1fr; min-height: 340px; } .closing-copy { padding: 36px 20px 36px 0; } .closing-copy h2 { font-size: 34px; } .closing-actions { gap: 10px; } .faq-section { padding-block: 65px; grid-template-columns: 1fr; gap: 27px; } }
@media (max-width: 480px) { h1 { font-size: clamp(64px, 18vw, 84px); } h1 br:nth-of-type(2) { display: initial; } h1 > span::before { content: none; } .hero { padding-top: 103px; } .intro { font-size: 11px; margin-bottom: 18px; } .hero-stage { aspect-ratio: 1; } .hero-description { font-size: 14px; max-width: 330px; } .stage-topline { left: 17px; top: 16px; right: 15px; } .stage-caption { left: 18px; right: 18px; bottom: 17px; font-size: 9px; } .collection-tag { left: 18px; bottom: 51px; font-size: 9px; padding: 6px 8px; } .stage-caption > span:first-child > svg { display: none; } .stage-live { font-size: 7px; } .material-title { font-size: 9px; } .material-options { gap: 2px; } .material-swatch { width: 31px; height: 34px; } .edit-example { width: 32px; height: 34px; flex-shrink: 0; } .section-heading { display: block; } .section-heading > p { margin-top: 20px; max-width: 290px; } .example-grid { grid-template-columns: 1fr; gap: 20px; } .example-art { aspect-ratio: 1.13; } .example-material { bottom: 20px; left: 20px; font-size: 11px; } .example-open { display: grid; } .example-text { padding: 15px 0 3px; } .example-text h3 { font-size: 16px; } .example-text p { font-size: 11px; } .closing-section { grid-template-columns: 1fr; } .closing-art { height: 235px; } .closing-art img { object-position: center 45%; } .closing-copy { padding: 5px 26px 33px; } .closing-copy h2 { font-size: 36px; } .closing-actions { gap: 10px 18px; } .faq-section h2 { font-size: 34px; } }
@media (max-width: 360px) { .hero-actions .action { padding-inline: 12px; gap: 12px; font-size: 12px; } .material-bar { padding-inline: 0; gap: 6px; } .material-swatch { width: 28px; } .stage-caption { font-size: 8px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none; animation: none; } }
</style>
