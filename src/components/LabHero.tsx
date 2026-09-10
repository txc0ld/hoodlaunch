import { useEffect, useRef, useState } from "react";
import styles from "./LabHero.module.css";

const CHAPTERS = [
  { title: "Shape the idea.", text: "Set your token’s identity, explore the numbers and choose a supported PONS pair.", label: "Plan your launch", href: "#pons-plan", detail: "01 / Plan" },
  { title: "Know every detail.", text: "See current protocol terms alongside your launch draft. Review the configuration before your wallet signs.", label: "Open the workspace", href: "#launch", detail: "02 / Prepare" },
  { title: "Room to grow.", text: "One wallet every 24 hours for Free accounts when creation is available. Up to 50 at a time with Pro.", label: "Compare Free and Pro", href: "/pro", detail: "03 / Expand" },
];

function Arrow() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>; }

export default function LabHero() {
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const hero = useRef<HTMLElement>(null);
  const journey = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    setMotionEnabled(!preference.matches && !connection?.saveData);
    const sync = (event: MediaQueryListEvent) => setMotionEnabled(!event.matches && !connection?.saveData);
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element || !motionEnabled || videoFailed) { element?.pause(); return; }
    let visible = true, disposed = false;
    const sync = () => {
      if (disposed) return;
      if (visible && document.visibilityState === "visible") void element.play().catch(error => {
        // A visibility change can interrupt a pending play request without breaking the media.
        if (!disposed && visible && document.visibilityState === "visible" && error?.name !== "AbortError") setVideoFailed(true);
      });
      else element.pause();
    };
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); }, { threshold: 0.01 });
    observer.observe(element);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => { disposed = true; element.pause(); observer.disconnect(); document.removeEventListener("visibilitychange", sync); };
  }, [motionEnabled, videoFailed]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!hero.current || !journey.current) return;
      const bounds = hero.current.getBoundingClientRect();
      const progress = motionEnabled ? Math.max(0, Math.min(1, -bounds.top / Math.max(1, bounds.height))) : 0;
      hero.current.style.setProperty("--hero-progress", progress.toFixed(4));
      const story = journey.current.getBoundingClientRect();
      const storyProgress = motionEnabled ? Math.max(0, Math.min(1, (window.innerHeight * 0.55 - story.top) / Math.max(1, story.height - window.innerHeight * 0.25))) : 0;
      journey.current.style.setProperty("--chapter-progress", storyProgress.toFixed(4));
      journey.current.dataset.active = String(Math.min(2, Math.floor(storyProgress * 3)));
      const chapters = Array.from(journey.current.querySelectorAll<HTMLElement>("article"));
      const reveals = chapters.map(chapter => Math.max(0, Math.min(1, (window.innerHeight - chapter.getBoundingClientRect().top) / Math.max(1, window.innerHeight * 0.55))));
      chapters.forEach((chapter, index) => chapter.style.setProperty("--reveal", reveals[index].toFixed(4)));
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); };
  }, [motionEnabled]);

  return <>
    <section ref={hero} className={`${styles.hero} ${motionEnabled ? styles.inMotion : styles.paused}`} aria-labelledby="lab-hero-title">
      <div className={styles.atmosphere} aria-hidden="true">
        <img className={styles.poster} src="/media/hoodlabs-atmosphere.webp" width="1920" height="1080" alt="" fetchPriority="high" />
        {!videoFailed && <video ref={video} className={styles.film} src={motionEnabled ? "/media/hoodlabs-atmosphere.mp4" : undefined} poster="/media/hoodlabs-atmosphere.webp" muted loop playsInline preload="none" tabIndex={-1} onError={() => setVideoFailed(true)} />}
      </div>
      <div className={styles.copy}>
        <p className={styles.kicker}><span /> HOODLABS <i /> BUILT ON ROBINHOOD CHAIN</p>
        <h1 id="lab-hero-title" aria-label="hoodlabs"><span className={styles.wordmark} aria-hidden="true">𝖍𝖔𝖔𝖉𝖑𝖆𝖇𝖘</span></h1>
        <p className={styles.headline}>The hoodlab, advanced token launchpad.</p>
        <p className={styles.lede}>built on PONS, for the HOOD</p>
        <div className={styles.actions}>
          <a className={styles.primaryAction} href="#launch">Start a launch <Arrow /></a>
          <a className={styles.secondaryAction} href="#pons-plan">Plan your launch <span aria-hidden="true">↗</span></a>
        </div>
        <p className={styles.signature}>POWERED BY PONS <span>·</span> YOUR WALLET. YOUR CONTROL.</p>
      </div>
      <div className={styles.heroBottom}>
        <a href="#workflow" className={styles.scrollCue}><span className={styles.wheel} aria-hidden="true"><i /></span> Scroll to explore</a>
        <button className={styles.motionControl} type="button" onClick={() => { setVideoFailed(false); setMotionEnabled(current => !current); }} aria-pressed={motionEnabled}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{motionEnabled ? <path d="M8 6v12M16 6v12" /> : <path d="m8 5 11 7-11 7V5Z" />}</svg>
          {motionEnabled ? "Pause motion" : "Play motion"}
        </button>
      </div>
    </section>
    <section ref={journey} id="workflow" className={`${styles.journey} ${motionEnabled ? styles.journeyMotion : ""}`} aria-labelledby="routes-title" data-active="0">
      <div className={styles.journeyIntro}>
        <p className={styles.eyebrow}>A CLEARER WAY TO CREATE</p>
        <h2 id="routes-title">Everything,<br /><span>in its place.</span></h2>
        <p>From the first decision to the final review. A workspace that keeps you focused.</p>
        <div className={styles.progressTrack} aria-hidden="true"><span /></div>
        <a href="#launch">Enter the workspace <Arrow /></a>
      </div>
      <div className={styles.chapters}>{CHAPTERS.map((chapter, index) => <article key={chapter.title} className={styles.chapter}>
        <div className={styles.chapterTop}><span>{chapter.detail}</span><span className={styles.chapterGlyph} aria-hidden="true">{index === 0 ? "◇" : index === 1 ? "◎" : "↗"}</span></div>
        <h3>{chapter.title}</h3><p>{chapter.text}</p>
        <a href={chapter.href} {...(chapter.href.startsWith("/") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{chapter.label} <Arrow /></a>
      </article>)}</div>
    </section>
  </>;
}
