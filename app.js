(function () {
  "use strict";

  var currentView = "home";
  var jobs = [];
  var shots = [
    { name: "01 — Establishing shot", detail: "Wide landscape · Slow push-in · 4 seconds", image: "linear-gradient(130deg,#52636c,#111923 65%)" },
    { name: "02 — Hero reveal", detail: "Medium close-up · Orbit right · 3 seconds", image: "linear-gradient(130deg,#806b58,#211c20 65%)" },
    { name: "03 — Final moment", detail: "Low angle · Dolly forward · 4 seconds", image: "linear-gradient(130deg,#485a83,#151a28 65%)" }
  ];
  var canvasNodes = [
    { type: "INPUT", name: "Creative brief", description: "Describe the scene, product or story." },
    { type: "IMAGE", name: "Visual direction", description: "Create a reference frame or moodboard." },
    { type: "VIDEO", name: "Motion generation", description: "Animate the selected visual direction." }
  ];
  var uploadedFile = null;
  var searchQuery = "";

  var pageRoot = document.getElementById("pageRoot");
  var breadcrumb = document.getElementById("breadcrumbCurrent");
  var sidebar = document.getElementById("sidebar");
  var scrim = document.getElementById("sidebarScrim");
  var modalRoot = document.getElementById("modalRoot");
  var fileInput = document.getElementById("fileInput");

  var API_BASE_URL = "https://teslafield-api.onrender.com";

  function checkBackendConnection() {
    var actions = document.querySelector(".topbar-actions");
    if (!actions) return;

    var status = document.getElementById("backendConnectionStatus");
    if (!status) {
      status = document.createElement("span");
      status.id = "backendConnectionStatus";
      status.setAttribute("role", "status");
      status.textContent = "Checking API…";
      status.style.cssText = "display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid var(--line,rgba(255,255,255,.14));border-radius:999px;color:var(--muted,#aab0bb);font-size:11px;white-space:nowrap";
      actions.insertBefore(status, actions.firstChild);
    }

    fetch(API_BASE_URL + "/api/v1/status", { method: "GET", mode: "cors" })
      .then(function (response) {
        if (!response.ok) throw new Error("API returned " + response.status);
        return response.json();
      })
      .then(function (data) {
        status.textContent = data && data.service === "teslafield-api" ? "● API connected" : "● API responded";
        status.style.color = "#9fe3ad";
        status.style.borderColor = "rgba(110,210,140,.35)";
        status.title = "TESLAFIELD backend is reachable. AI generation integrations are not connected yet.";
      })
      .catch(function () {
        status.textContent = "● API unavailable";
        status.style.color = "#f0bd85";
        status.style.borderColor = "rgba(240,189,133,.35)";
        status.title = "Could not reach the TESLAFIELD backend. Check Render service status and CORS settings.";
      });
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char];
    });
  }

  function toast(message, mark) {
    var region = document.getElementById("toastRegion");
    var node = document.createElement("div");
    node.className = "toast";
    node.innerHTML = '<span class="toast-mark">' + (mark || "✦") + '</span><span>' + esc(message) + '</span>';
    region.appendChild(node);
    window.setTimeout(function () { node.remove(); }, 4200);
  }

  function heading(eyebrow, title, subtitle, actions) {
    return '<div class="heading-row"><div><div class="page-eyebrow">' + eyebrow + '</div><h1 class="page-heading">' + title + '</h1><p class="page-subtitle">' + subtitle + '</p></div><div class="heading-actions">' + (actions || "") + '</div></div>';
  }

  function toolCard(icon, title, description, view, tint) {
    return '<button class="tool-card" data-view="' + view + '" style="--glow:' + tint + '"><span class="tool-arrow">↗</span><span class="tool-icon">' + icon + '</span><h3>' + title + '</h3><p>' + description + '</p></button>';
  }

  function renderHome() {
    var recent = jobs.length ? jobs.slice(0, 3).map(function (job) {
      return '<div class="project-row"><div class="project-thumb" style="background:' + job.thumb + '"></div><div class="project-copy"><strong>' + esc(job.title) + '</strong><small>' + esc(job.kind) + ' · Just now · Local preview</small></div><span class="project-status">Demo</span></div>';
    }).join("") : '<div class="empty-state"><div class="empty-icon">✧</div><strong>Your creative library starts here</strong><p>Start a video, build an image, or plan a cinematic sequence. Demo jobs will appear here while AI services are not connected.</p><button class="btn btn-small btn-quiet" data-view="video">Open video studio ↗</button></div>';

    return heading("YOUR CREATIVE WORKSPACE", "Make something <span style='color:var(--accent)'>unforgettable.</span>", "A connected creative studio for ideas, images, motion and cinematic storytelling.", '<button class="btn btn-quiet" data-view="library">View library</button><button class="btn btn-primary" data-view="video"><span class="icon-inline">＋</span> Create new</button>') +
      '<section class="hero-card"><div class="hero-content"><div class="hero-kicker"><span class="live-dot"></span> THE NEXT GENERATION CREATIVE STUDIO</div><h2 class="hero-title">Your imagination.<br><em>Directed.</em></h2><p class="hero-copy">Turn a simple idea into a directed visual experience. Plan the scene, shape the camera, build your assets and bring every frame together.</p><div class="hero-cta"><button class="btn btn-primary" data-view="director">Meet your AI Director <span>↗</span></button><button class="btn btn-quiet" data-view="cinema">Explore Cinema Director</button></div><div class="hero-note">IMAGE  ·  VIDEO  ·  AUDIO  ·  CREATIVE WORKFLOWS</div></div></section>' +
      '<section class="stat-strip"><div class="stat-item"><strong>04</strong><span>Creative studios</span></div><div class="stat-item"><strong>01</strong><span>Connected workspace</span></div><div class="stat-item"><strong>∞</strong><span>Ideas to explore</span></div></section>' +
      '<div class="section-head"><div><h2>Start creating</h2><p>Choose a workflow that matches what you want to make.</p></div><button class="text-link" data-view="video">Explore all tools ↗</button></div>' +
      '<section class="tool-grid">' +
      toolCard("▶", "Video studio", "Turn a text idea or reference image into a motion concept.", "video", "rgba(141,184,255,.16)") +
      toolCard("▧", "Image studio", "Explore art direction, product visuals and key frames.", "image", "rgba(173,155,255,.16)") +
      toolCard("◉", "Cinema director", "Structure multi-shot scenes with camera and lens language.", "cinema", "rgba(255,180,119,.15)") +
      toolCard("◈", "Ad studio", "Plan product-led campaigns and short-form ad concepts.", "ads", "rgba(168,239,115,.14)") +
      '</section>' +
      '<div class="section-head"><div><h2>Keep building</h2><p>Your recent local preview activity and creative workspace.</p></div><button class="text-link" data-view="library">Open generations ↗</button></div>' +
      '<div class="two-column"><section class="panel"><div class="panel-title-row"><h3>Recent activity</h3><span>' + jobs.length + ' local demo jobs</span></div><div class="project-list">' + recent + '</div></section>' +
      '<section class="panel tip-card"><div class="tip-mark">✳</div><span class="badge badge-violet">CREATOR NOTE</span><h3>Start with the shot, not the model.</h3><p>Write down the subject, action, environment and camera movement first. A clear creative brief makes every generation workflow easier to direct.</p><button class="btn btn-small btn-quiet" data-view="cinema">Plan a scene ↗</button></section></div>';
  }

  function renderExplore() {
    var presets = [
      { category: "CINEMATIC", title: "The last horizon", detail: "A sweeping landscape reveal with a slow camera push.", target: "cinema", prompt: "A lone traveller stands at the edge of a vast mountain range at first light. Wind moves through the grass. Wide establishing frame, slow cinematic push-in, cool atmosphere with warm sunrise highlights.", image: "url(https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1000&q=80)" },
      { category: "PRODUCT FILM", title: "Object of desire", detail: "Premium studio lighting for a hero product visual.", target: "image", prompt: "A sculptural premium product on a dark reflective surface, controlled studio lighting, elegant reflections, detailed material texture, high-end commercial photography.", image: "url(https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1000&q=80)" },
      { category: "SCI-FI", title: "Signal from beyond", detail: "A mysterious world with a slow tracking shot.", target: "video", prompt: "A solitary astronaut discovers a glowing signal in a silent alien valley. Atmospheric haze, subtle particles, cinematic science fiction realism, slow tracking camera move.", image: "url(https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=1000&q=80)" },
      { category: "CAMPAIGN", title: "Made for movement", detail: "A vertical product campaign built around energy and speed.", target: "ads", prompt: "Create a premium energetic product campaign. Focus on a strong opening hook, close-up product details, a clear use moment and a memorable final call to action.", image: "url(https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=1000&q=80)" },
      { category: "EDITORIAL", title: "After the rain", detail: "A fashion-led portrait with reflective city light.", target: "image", prompt: "A cinematic editorial portrait on a rain-soaked city street at blue hour, reflective pavement, soft rim light, natural expression, premium magazine art direction.", image: "url(https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=1000&q=80)" },
      { category: "FANTASY", title: "A world of quiet giants", detail: "A large-scale environment ready for story development.", target: "cinema", prompt: "A traveller walks between enormous ancient stone structures covered in moss, distant waterfalls, soft atmospheric fog, epic scale, wide lens and slow crane movement.", image: "url(https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1000&q=80)" }
    ];
    var cards = presets.map(function (preset) {
      return '<article class="preset-card"><div class="preset-visual" style="background-image:linear-gradient(0deg,rgba(5,8,12,.88),rgba(5,8,12,.05) 72%),' + preset.image + '"><span class="preset-category">' + preset.category + '</span><div class="preset-visual-title">' + preset.title + '</div></div><div class="preset-details"><p>' + preset.detail + '</p><button class="btn btn-small btn-quiet" data-action="use-preset" data-target="' + preset.target + '" data-prompt="' + esc(preset.prompt) + '">Use this direction ↗</button></div></article>';
    }).join("");
    return heading("FIND YOUR NEXT IDEA", "Explore directions", "Start from a visual idea, then make it your own. Presets are creative starting points, not fixed templates.", '<button class="btn btn-primary" data-view="director">Describe an idea <span>↗</span></button>') +
      '<div class="director-box"><h3>✧ A starting point, not a limitation</h3><p>Choose a visual direction to prefill a creative brief. Change the subject, reference, camera language and settings before you continue.</p></div>' +
      '<div class="chip-row" style="margin:0 0 16px"><button class="choice-chip selected" data-choice="all">All directions</button><button class="choice-chip" data-choice="cinematic">Cinematic</button><button class="choice-chip" data-choice="product">Product</button><button class="choice-chip" data-choice="sci-fi">Sci-fi</button><button class="choice-chip" data-choice="editorial">Editorial</button><button class="choice-chip" data-choice="fantasy">Fantasy</button></div>' +
      '<div class="preset-grid">' + cards + '</div>';
  }

  function renderVideoStudio(kind) {
    var isImage = kind === "image";
    var title = isImage ? "Image studio" : "Video studio";
    var intro = isImage ? "Build your visual direction with prompts, references and reusable styles." : "Direct motion from a prompt or reference frame, with controls that help shape the shot.";
    var viewLabel = isImage ? "IMAGE CREATION" : "MOTION CREATION";
    var promptLabel = isImage ? "Describe the image" : "Describe the video";
    var sample = isImage ? "A sculptural glass perfume bottle on black stone, soft directional light, premium editorial product photography..." : "A lone explorer walks through a vast salt desert at blue hour. Fine dust drifts across the frame as the camera slowly pushes forward...";
    var modes = isImage ? '<button class="selected" data-choice-group="mode">Text to image</button><button data-choice-group="mode">Image edit</button>' : '<button class="selected" data-choice-group="mode">Text to video</button><button data-choice-group="mode">Image to video</button>';
    var durationControl = isImage ? "" : '<div class="control-section"><div class="control-label">Duration <small>Clip length</small></div><div class="segmented"><button class="selected" data-choice-group="duration">5 sec</button><button data-choice-group="duration">8 sec</button><button data-choice-group="duration">10 sec</button></div></div>';
    var directionControl = isImage ? '<div class="control-section"><div class="control-label">Composition</div><div class="chip-row"><button class="choice-chip selected" data-choice="editorial close-up">Editorial close-up</button><button class="choice-chip" data-choice="wide frame">Wide frame</button><button class="choice-chip" data-choice="top-down">Top-down</button><button class="choice-chip" data-choice="symmetrical">Symmetrical</button><button class="choice-chip" data-choice="macro">Macro detail</button></div></div>' : '<div class="control-section"><div class="control-label">Camera movement</div><div class="chip-row"><button class="choice-chip selected" data-choice="slow push">Slow push</button><button class="choice-chip" data-choice="orbit">Orbit</button><button class="choice-chip" data-choice="tracking">Tracking</button><button class="choice-chip" data-choice="crane">Crane</button><button class="choice-chip" data-choice="static">Static</button></div></div>';
    return heading(viewLabel, title, intro, '<button class="btn btn-quiet" data-view="library">My generations</button><button class="btn btn-primary" data-action="new-project">＋ New project</button>') +
      '<div class="studio-layout"><section class="studio-main">' +
      '<div class="studio-preview"><div class="preview-tools"><button data-action="preview-reset">Reset preview</button><button data-action="upload">＋ Reference</button></div><div class="preview-frame" id="previewFrame"><div class="preview-overlay"><div class="preview-topline"><span>TESLAFIELD / ' + (isImage ? "IMAGE" : "MOTION") + '</span><span>PREVIEW CANVAS</span></div><div class="preview-center">▶</div><div class="preview-caption">' + (isImage ? "Shape the impossible." : "Every frame has a story.") + '</div></div></div><div class="preview-hint" id="previewHint">Reference preview · Upload a file to personalise this frame</div></div>' +
      '<div class="section-head"><div><h2>Creation workspace</h2><p>Adjust the brief before sending it to a generation engine.</p></div><span class="badge badge-green">INTERACTIVE DEMO</span></div>' +
      '<div class="panel"><div class="panel-title-row"><h3>Generation settings</h3><span>Step 1 of 2</span></div><div class="control-section"><div class="control-label">Creation mode</div><div class="segmented">' + modes + '</div></div>' +
      '<div class="control-section"><div class="control-label">' + promptLabel + '<small>Be specific about subject, action and atmosphere</small></div><textarea class="textarea-field" id="creationPrompt" placeholder="' + sample + '"></textarea><div class="field-note">Tip: describe one main action and one clear camera move for a more controllable shot.</div></div>' +
      '<div class="control-section"><div class="control-label">Reference media <small>Optional</small></div><button class="upload-zone" style="width:100%" data-action="upload"><span class="upload-symbol">＋</span><strong id="uploadTitle">Drop a reference image or browse files</strong><small id="uploadNote">PNG, JPG, WEBP · Local preview only</small></button></div>' +
      '<div class="control-section"><div class="control-label">Visual direction</div><div class="chip-row"><button class="choice-chip selected" data-choice="cinematic">Cinematic</button><button class="choice-chip" data-choice="editorial">Editorial</button><button class="choice-chip" data-choice="photoreal">Photoreal</button><button class="choice-chip" data-choice="dreamlike">Dreamlike</button><button class="choice-chip" data-choice="minimal">Minimal</button></div></div>' +
      '</div></section>' +
      '<aside class="studio-controls"><div class="panel-title-row"><h3>Output controls</h3><span>DEMO ENGINE</span></div>' +
      '<div class="control-section"><div class="control-label">Model route <small>Planned integration</small></div><select class="select-field" id="modelRoute"><option>TESLAFIELD Motion Engine · Demo</option><option>Partner model adapter · Not connected</option><option>Local preview · No AI</option></select></div>' +
      '<div class="control-section"><div class="control-label">Aspect ratio</div><div class="segmented" id="ratioOptions"><button class="selected" data-ratio="16:9">16:9</button><button data-ratio="9:16">9:16</button><button data-ratio="1:1">1:1</button></div></div>' +
      durationControl +
      directionControl +
      '<div class="control-section"><div class="control-label">Quality</div><select class="select-field"><option>Preview · 720p</option><option>1080p · Planned</option><option>4K · Planned</option></select></div>' +
      '<button class="generate-button" data-action="' + (isImage ? "generate-image" : "generate-video") + '">✦  Create ' + (isImage ? "image" : "video") + ' concept</button><div class="demo-disclaimer"><span>ⓘ</span><span>This prototype does not call an AI model or spend credits. Connect a generation API and backend before production use.</span></div>' +
      '</aside></div>';
  }

  function renderCinema() {
    var shotMarkup = shots.map(function (shot, index) {
      return '<div class="shot-card"><div class="shot-visual" style="background:' + shot.image + '"></div><div><strong>' + esc(shot.name) + '</strong><small>' + esc(shot.detail) + '</small></div><div class="shot-actions"><button data-action="edit-shot" data-index="' + index + '">Edit</button><button data-action="remove-shot" data-index="' + index + '">×</button></div></div>';
    }).join("");
    return heading("DIRECT YOUR STORY", "Cinema director", "Move from an idea to a sequence of intentional shots. Shape the story, camera language and visual continuity.", '<button class="btn btn-quiet" data-action="cinema-reset">Reset scene</button><button class="btn btn-primary" data-action="director-plan">✳ Draft shot plan</button>') +
      '<div class="director-box"><h3>✳ Director&#39;s desk <span class="badge badge-violet">CREATIVE ASSISTANT · DEMO</span></h3><p>Start with a scene brief. Break it into shots, assign a camera move to each moment, and keep the same visual language across the sequence. This is a planning interface; automatic AI direction is not connected yet.</p></div>' +
      '<div class="two-column"><section class="panel"><div class="panel-title-row"><h3>Scene brief</h3><span>PROJECT / UNTITLED FILM</span></div><div class="control-label">What happens in this scene?</div><textarea class="textarea-field" id="sceneBrief" placeholder="A courier arrives at an abandoned observatory during a storm. The doors open and a warm light spills into the rain..."></textarea><div class="control-section"><div class="control-label">Genre / visual language</div><div class="chip-row"><button class="choice-chip selected" data-choice="sci-fi">Sci-fi</button><button class="choice-chip" data-choice="drama">Drama</button><button class="choice-chip" data-choice="thriller">Thriller</button><button class="choice-chip" data-choice="documentary">Documentary</button><button class="choice-chip" data-choice="fantasy">Fantasy</button></div></div></section>' +
      '<section class="panel"><div class="panel-title-row"><h3>Director controls</h3><span>GLOBAL LOOK</span></div><div class="control-section"><div class="control-label">Camera language</div><select class="select-field"><option>Naturalistic cinema</option><option>Large-format epic</option><option>Handheld documentary</option><option>Commercial product film</option></select></div><div class="control-section"><div class="control-label">Lens character</div><select class="select-field"><option>35mm · Balanced</option><option>24mm · Wide perspective</option><option>50mm · Natural portrait</option><option>85mm · Compressed portrait</option></select></div><div class="control-section"><div class="control-label">Color treatment</div><select class="select-field"><option>Cool shadows / warm highlights</option><option>Soft natural daylight</option><option>High contrast monochrome</option><option>Pastel film</option></select></div></section></div>' +
      '<div class="section-head"><div><h2>Shot sequence</h2><p>Each shot can be developed and refined independently.</p></div><button class="btn btn-small btn-quiet" data-action="add-shot">＋ Add shot</button></div><section class="panel"><div class="shot-list" id="shotList">' + shotMarkup + '</div></section><div id="directorResult"></div>';
  }

  function renderAds() {
    return heading("CAMPAIGN PRODUCTION", "Ad studio", "Turn a product brief into a structured campaign concept with hooks, scenes, formats and creative variations.", '<button class="btn btn-quiet" data-view="library">Campaign history</button><button class="btn btn-primary" data-action="ad-generate">✦ Build ad concept</button>') +
      '<div class="two-column"><section class="panel"><div class="panel-title-row"><h3>01 / Product brief</h3><span>START WITH THE OFFER</span></div><div class="control-section"><div class="control-label">Product or campaign name</div><input class="field" id="productName" placeholder="e.g. Aurora wireless headphones"></div><div class="control-section"><div class="control-label">Product page or destination <small>Optional</small></div><input class="field" id="productUrl" placeholder="https://your-store.com/product"></div><div class="control-section"><div class="control-label">What makes it worth choosing?</div><textarea class="textarea-field" id="productBrief" placeholder="Describe the product, audience, key benefit, price point and campaign goal..."></textarea></div><div class="control-section"><div class="control-label">Product reference</div><button class="upload-zone" style="width:100%" data-action="upload"><span class="upload-symbol">＋</span><strong>Upload product photo</strong><small>Front-facing product image works best</small></button></div></section>' +
      '<section class="panel"><div class="panel-title-row"><h3>02 / Creative format</h3><span>CHOOSE A STORYTELLING STYLE</span></div><div class="format-grid"><button class="format-card selected" data-choice="ugc"><span>◉</span><strong>UGC review</strong><small>Creator-led story</small></button><button class="format-card" data-choice="unboxing"><span>▣</span><strong>Unboxing</strong><small>First impression</small></button><button class="format-card" data-choice="tutorial"><span>⌁</span><strong>Tutorial</strong><small>Show the value</small></button><button class="format-card" data-choice="tv spot"><span>✦</span><strong>TV spot</strong><small>Premium campaign</small></button></div><div class="control-section"><div class="control-label">Campaign tone</div><div class="chip-row"><button class="choice-chip selected" data-choice="premium">Premium</button><button class="choice-chip" data-choice="playful">Playful</button><button class="choice-chip" data-choice="bold">Bold</button><button class="choice-chip" data-choice="trustworthy">Trustworthy</button></div></div><div class="control-section"><div class="control-label">Output formats</div><div class="chip-row"><button class="choice-chip selected" data-choice="9:16">Vertical 9:16</button><button class="choice-chip" data-choice="1:1">Square 1:1</button><button class="choice-chip" data-choice="16:9">Wide 16:9</button></div></div><div class="director-box" style="margin-top:16px"><h3>Creative pipeline</h3><p>Product brief → hook ideas → storyboard → shot list → generated clips → final edit. Each stage should be reviewable before the next one is run.</p></div><button class="generate-button" data-action="ad-generate">✦ Generate campaign outline</button><div class="demo-disclaimer"><span>ⓘ</span><span>Campaign planning only in this prototype. No ad video or external model call is made.</span></div></section></div><div id="adResult"></div>';
  }

  function renderCharacters() {
    return heading("IDENTITY & REUSABLE ASSETS", "Characters & assets", "Keep approved visual references organised so future scenes can share the same characters, products and environments.", '<button class="btn btn-quiet" data-view="library">Browse assets</button><button class="btn btn-primary" data-action="upload">＋ Add reference</button>') +
      '<div class="director-box"><h3>Identity-first production</h3><p>For consistent storytelling, store approved references with clear names and usage notes. Real character training, face matching and cross-generation identity locking require a dedicated model and explicit consent controls; they are not active in this prototype.</p></div>' +
      '<div class="two-column"><section class="panel"><div class="panel-title-row"><h3>New character reference</h3><span>LOCAL PREVIEW</span></div><div class="control-section"><div class="control-label">Character name</div><input class="field" id="characterName" placeholder="e.g. The midnight courier"></div><div class="control-section"><div class="control-label">Reference images</div><button class="upload-zone" style="width:100%" data-action="upload"><span class="upload-symbol">＋</span><strong id="characterUploadTitle">Upload character reference images</strong><small>Use only images you own or have permission to use</small></button></div><div class="control-section"><div class="control-label">Continuity notes</div><textarea class="textarea-field" id="characterNotes" placeholder="Wardrobe, age range, signature details, visual style, do-not-change traits..."></textarea></div><button class="generate-button" data-action="save-character">＋ Save reference card</button></section>' +
      '<section class="panel"><div class="panel-title-row"><h3>Reference library</h3><span>STARTER COLLECTION</span></div><div class="asset-grid"><div class="asset-card"><div class="asset-image" style="--asset:linear-gradient(140deg,#293c4c,#0e121a 70%)"></div><div class="asset-info"><strong>Explorer / Concept 01</strong><small>Character reference · Example</small></div></div><div class="asset-card"><div class="asset-image" style="--asset:linear-gradient(140deg,#7b6a58,#20202a 70%)"></div><div class="asset-info"><strong>Desert observatory</strong><small>Environment · Example</small></div></div></div><div class="field-note" style="margin-top:12px">Example cards are placeholders. Saved cards are stored only in this browser session.</div></section></div><div id="characterResult"></div>';
  }

  function renderCanvas() {
    var nodes = canvasNodes.map(function (node, index) {
      return '<div class="canvas-node"><div class="node-head"><span>' + esc(node.type) + ' NODE</span><span>' + String(index + 1).padStart(2, "0") + '</span></div><strong>' + esc(node.name) + '</strong><small>' + esc(node.description) + '</small></div>' + (index < canvasNodes.length - 1 ? '<span class="node-connector">⟶</span>' : '');
    }).join("");
    return heading("VISUAL WORKFLOW BUILDER", "Creative canvas", "Connect creative steps into a reusable production pipeline. Build the workflow before spending time or compute on generation.", '<button class="btn btn-quiet" data-action="canvas-reset">Reset board</button><button class="btn btn-primary" data-action="add-node">＋ Add node</button>') +
      '<div class="canvas-toolbar"><span class="badge badge-green">UNSAVED WORKFLOW</span><span class="badge">3 starter nodes</span><button class="btn btn-small btn-quiet" data-action="save-canvas">Save template</button><button class="btn btn-small btn-quiet" data-action="run-canvas">Run workflow</button></div>' +
      '<section class="canvas-board"><div class="canvas-nodes" id="canvasNodes">' + nodes + '</div></section>' +
      '<div class="two-column" style="margin-top:15px"><section class="panel"><div class="panel-title-row"><h3>How the board works</h3><span>WORKFLOW LOGIC</span></div><p class="page-subtitle">1. Add an input or prompt node. 2. Connect it to an image, video or audio step. 3. Pass outputs to the next node. 4. Save the sequence as a reusable template.</p></section><section class="panel tip-card"><div class="tip-mark">⌘</div><h3>Build once. Reuse the pipeline.</h3><p>Useful workflows can become templates for recurring product videos, character scenes or social campaigns.</p></section></div>';
  }

  function renderAudio() {
    return heading("VOICE & SOUND DESIGN", "Audio studio", "Plan voiceovers, sound effects and music direction as part of the same production workflow.", '<button class="btn btn-quiet" data-view="library">Audio library</button>') +
      '<div class="two-column"><section class="panel"><div class="panel-title-row"><h3>Voiceover brief</h3><span>TEXT TO SPEECH · PLANNED</span></div><div class="control-section"><div class="control-label">Script or spoken words</div><textarea class="textarea-field" id="audioScript" placeholder="Write the narration, dialogue or voiceover you want to hear..."></textarea></div><div class="control-section"><div class="control-label">Voice character</div><select class="select-field"><option>Warm, confident narrator</option><option>Calm documentary voice</option><option>Energetic product presenter</option><option>Character dialogue</option></select></div><div class="control-section"><div class="control-label">Language</div><select class="select-field"><option>English</option><option>Tamil</option><option>Hindi</option><option>Spanish</option><option>French</option></select></div><button class="generate-button" data-action="audio-generate">✦ Create voiceover preview</button><div class="demo-disclaimer"><span>ⓘ</span><span>Audio generation is not connected. This button creates a planning note only.</span></div></section>' +
      '<section class="panel"><div class="panel-title-row"><h3>Sound direction</h3><span>MOOD BOARD</span></div><div class="control-section"><div class="control-label">Music mood</div><div class="chip-row"><button class="choice-chip selected" data-choice="cinematic">Cinematic</button><button class="choice-chip" data-choice="ambient">Ambient</button><button class="choice-chip" data-choice="electronic">Electronic</button><button class="choice-chip" data-choice="orchestral">Orchestral</button></div></div><div class="control-section"><div class="control-label">Sound layers</div><div class="chip-row"><button class="choice-chip selected" data-choice="ambience">Ambience</button><button class="choice-chip" data-choice="foley">Foley</button><button class="choice-chip" data-choice="impact">Impacts</button><button class="choice-chip" data-choice="music">Music</button></div></div><div class="empty-state" style="margin-top:16px"><div class="empty-icon">♫</div><strong>Your audio timeline is ready for a soundtrack</strong><p>Generated audio, licensing information and export controls will appear here after an audio provider is integrated.</p></div></section></div>';
  }

  function renderEditor() {
    return heading("POST-PRODUCTION", "Motion editor", "Arrange generated clips, manage timing and prepare a final sequence. This is an interface prototype, not a media-rendering engine.", '<button class="btn btn-quiet" data-action="upload">＋ Import media</button><button class="btn btn-primary" data-action="editor-export">Export setup</button>') +
      '<section class="panel"><div class="panel-title-row"><h3>Preview monitor</h3><span>SEQUENCE / 00:00:12</span></div><div class="studio-preview" style="min-height:290px"><div class="preview-frame" style="background-image:linear-gradient(120deg,rgba(0,0,0,.08),rgba(0,0,0,.6)),url(https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80)"><div class="preview-overlay"><div class="preview-topline"><span>TESLAFIELD EDITOR</span><span>16:9 · 24 FPS</span></div><div class="preview-center">▶</div><div class="preview-caption">Your story, frame by frame.</div></div></div></div><div class="section-head"><div><h2>Timeline</h2><p>Conceptual sequence · Drag and drop editing will be added with the media engine.</p></div><span class="badge">12.0 SEC</span></div><div class="control-section"><div class="control-label">VIDEO TRACK 01</div><div style="display:flex;gap:5px;height:47px"><div style="flex:1;background:linear-gradient(120deg,#365166,#253444);border-radius:6px;padding:8px;font-size:8px">Shot 01 · Establish</div><div style="flex:1.2;background:linear-gradient(120deg,#645342,#312a2e);border-radius:6px;padding:8px;font-size:8px">Shot 02 · Reveal</div><div style="flex:.8;background:linear-gradient(120deg,#464a73,#22263d);border-radius:6px;padding:8px;font-size:8px">Shot 03</div></div></div><div class="control-section"><div class="control-label">AUDIO TRACK 01</div><div style="height:25px;border-radius:5px;background:repeating-linear-gradient(90deg,rgba(168,239,115,.4) 0 3px,transparent 3px 7px),#1b2a20"></div></div></section>';
  }

  function renderDirector() {
    return heading("YOUR CREATIVE PARTNER", "Meet your AI Director", "A creative planning layer that turns a brief into a shot plan, visual references and a production checklist.", '<button class="btn btn-quiet" data-view="cinema">Open shot workspace</button>') +
      '<section class="panel" style="max-width:850px;margin:0 auto"><div class="director-box"><h3>✳ TESLAFIELD DIRECTOR <span class="badge badge-violet">PLANNING DEMO</span></h3><p>Describe the outcome you want. The planned Director workflow will clarify the goal, propose scenes, recommend visual direction and prepare prompts for the relevant studio.</p></div><div class="control-label">What would you like to create?</div><textarea class="textarea-field" id="directorBrief" style="min-height:135px" placeholder="Create a 20-second cinematic launch film for a new electric motorcycle. The setting is a rain-soaked city at night. The mood is premium, bold and futuristic..."></textarea><div class="control-section"><div class="control-label">Project type</div><div class="chip-row"><button class="choice-chip selected" data-choice="cinematic film">Cinematic film</button><button class="choice-chip" data-choice="product ad">Product ad</button><button class="choice-chip" data-choice="social content">Social content</button><button class="choice-chip" data-choice="story sequence">Story sequence</button></div></div><div class="control-section"><div class="control-label">Preferred output</div><div class="segmented"><button class="selected" data-choice-group="director-output">Storyboard</button><button data-choice-group="director-output">Shot list</button><button data-choice-group="director-output">Campaign plan</button></div></div><button class="generate-button" data-action="director-plan">✳ Create production plan</button><div class="demo-disclaimer"><span>ⓘ</span><span>Planning output is a local demo. Connect a language model and workflow service for real AI assistance.</span></div><div id="directorResult"></div></section>';
  }

  function renderLibrary() {
    var filtered = jobs.filter(function (job) {
      return !searchQuery || (job.title + " " + job.kind).toLowerCase().indexOf(searchQuery.toLowerCase()) >= 0;
    });
    var cards = filtered.map(function (job, index) {
      return '<div class="asset-card"><div class="asset-image" style="--asset:' + job.thumb + '"><span class="asset-type">' + esc(job.kind.toUpperCase()) + ' · DEMO</span></div><div class="asset-info"><strong>' + esc(job.title) + '</strong><small>Local preview · ' + esc(job.time) + '</small></div></div>';
    }).join("");
    return heading("YOUR CREATIVE LIBRARY", "Generations", "All prototype generation requests are collected here. Real model outputs will appear after the generation backend is connected.", '<button class="btn btn-primary" data-view="video">＋ Create new</button>') +
      '<div class="panel" style="margin-bottom:15px"><div class="panel-title-row"><h3>Library filters</h3><span>' + filtered.length + ' items</span></div><div class="chip-row"><button class="choice-chip selected" data-choice="all">All</button><button class="choice-chip" data-choice="video">Video</button><button class="choice-chip" data-choice="image">Image</button><button class="choice-chip" data-choice="audio">Audio</button></div></div>' +
      (cards ? '<div class="asset-grid">' + cards + '</div>' : '<div class="empty-state"><div class="empty-icon">▦</div><strong>No generations yet</strong><p>' + (searchQuery ? "No local demo items match your search." : "Create your first video or image concept. It will be listed here as a local demo job.") + '</p><button class="btn btn-primary btn-small" data-view="video">Open video studio</button></div>');
  }

  function renderCurrentView() {
    var names = { home: "Overview", explore: "Explore presets", video: "Video studio", image: "Image studio", cinema: "Cinema director", ads: "Ad studio", characters: "Characters & assets", canvas: "Creative canvas", audio: "Audio studio", editor: "Motion editor", library: "Generations", director: "AI Director" };
    breadcrumb.textContent = names[currentView] || "Overview";
    document.querySelectorAll(".nav-link[data-view]").forEach(function (node) {
      node.classList.toggle("active", node.getAttribute("data-view") === currentView);
    });
    if (currentView === "home") pageRoot.innerHTML = renderHome();
    else if (currentView === "explore") pageRoot.innerHTML = renderExplore();
    else if (currentView === "video" || currentView === "image") pageRoot.innerHTML = renderVideoStudio(currentView);
    else if (currentView === "cinema") pageRoot.innerHTML = renderCinema();
    else if (currentView === "ads") pageRoot.innerHTML = renderAds();
    else if (currentView === "characters") pageRoot.innerHTML = renderCharacters();
    else if (currentView === "canvas") pageRoot.innerHTML = renderCanvas();
    else if (currentView === "audio") pageRoot.innerHTML = renderAudio();
    else if (currentView === "editor") pageRoot.innerHTML = renderEditor();
    else if (currentView === "library") pageRoot.innerHTML = renderLibrary();
    else if (currentView === "director") pageRoot.innerHTML = renderDirector();
    else pageRoot.innerHTML = renderHome();
    pageRoot.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
    closeSidebar();
  }

  function openView(view) {
    currentView = view;
    renderCurrentView();
  }

  function openModal(title, body) {
    modalRoot.innerHTML = '<div class="modal-card" role="dialog" aria-modal="true"><div class="modal-head"><h2>' + title + '</h2><button class="modal-close" data-action="close-modal" aria-label="Close">×</button></div>' + body + '<div class="modal-actions"><button class="btn btn-quiet" data-action="close-modal">Close</button></div></div>';
    modalRoot.addEventListener("click", function (event) {
      if (event.target === modalRoot) closeModal();
    }, { once: true });
  }

  function closeModal() { modalRoot.innerHTML = ""; }

  function closeSidebar() {
    sidebar.classList.remove("open");
    scrim.classList.remove("show");
  }

  function addJob(kind, title) {
    var accent = kind === "IMAGE" ? "linear-gradient(135deg,#574b78,#191b2b)" : "linear-gradient(135deg,#526a73,#17212b)";
    jobs.unshift({ kind: kind, title: title, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), thumb: accent });
    return jobs[0];
  }

  function createConcept(kind) {
    var prompt = document.getElementById("creationPrompt");
    var value = prompt ? prompt.value.trim() : "";
    if (!value) {
      toast("Add a creative prompt before creating a concept.", "!");
      if (prompt) prompt.focus();
      return;
    }
    var title = value.length > 52 ? value.slice(0, 49) + "..." : value;
    addJob(kind, title);
    toast("Local " + kind.toLowerCase() + " concept added to your library. No AI model was called.", "✦");
    renderCurrentView();
  }

  function planDirector() {
    var brief = document.getElementById("directorBrief") || document.getElementById("sceneBrief");
    var value = brief ? brief.value.trim() : "";
    if (!value) {
      toast("Write a short creative brief first.", "!");
      if (brief) brief.focus();
      return;
    }
    var target = document.getElementById("directorResult");
    if (!target) target = document.getElementById("adResult");
    if (target) {
      target.innerHTML = '<section class="panel" style="margin-top:15px"><div class="panel-title-row"><h3>Draft production plan</h3><span>LOCAL TEMPLATE · NOT AI GENERATED</span></div><div class="shot-list"><div class="shot-card"><div class="shot-visual" style="background:linear-gradient(130deg,#465b72,#151b26)"></div><div><strong>01 — Establish the world</strong><small>Wide frame · Define location, atmosphere and time of day.</small></div><span class="badge">4 sec</span></div><div class="shot-card"><div class="shot-visual" style="background:linear-gradient(130deg,#806653,#1c1a20)"></div><div><strong>02 — Reveal the subject</strong><small>Medium frame · Introduce the hero, product or main action.</small></div><span class="badge">5 sec</span></div><div class="shot-card"><div class="shot-visual" style="background:linear-gradient(130deg,#536d69,#151d22)"></div><div><strong>03 — The signature moment</strong><small>Close detail · Give the story its memorable visual beat.</small></div><span class="badge">4 sec</span></div></div><p class="field-note">Brief received: ' + esc(value.slice(0, 180)) + (value.length > 180 ? "…" : "") + '</p><div class="heading-actions" style="margin-top:12px"><button class="btn btn-primary btn-small" data-view="cinema">Open Cinema Director</button><button class="btn btn-quiet btn-small" data-action="copy-brief">Copy brief</button></div></section>';
      window.lastBrief = value;
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    toast("A starter shot structure is ready. The plan uses a local template, not an AI model.", "✳");
  }

  function handleAction(action, element) {
    if (action === "use-preset") {
      var presetPrompt = element.getAttribute("data-prompt") || "";
      var presetTarget = element.getAttribute("data-target") || "video";
      openView(presetTarget);
      var destination = document.getElementById("creationPrompt") || document.getElementById("sceneBrief") || document.getElementById("productBrief");
      if (destination) {
        destination.value = presetPrompt;
        destination.focus();
      }
      toast("Creative direction loaded. Make it your own before continuing.", "✧");
    } else if (action === "upload") {
      fileInput.value = "";
      fileInput.click();
    } else if (action === "generate-video") createConcept("VIDEO");
    else if (action === "generate-image") createConcept("IMAGE");
    else if (action === "new-project") openModal("Start a new project", '<p>Choose a creative path to start your next project.</p><div class="tool-grid" style="grid-template-columns:repeat(2,1fr)">' + toolCard("▶","Video","Create a motion concept.","video","rgba(141,184,255,.16)") + toolCard("▧","Image","Build a visual direction.","image","rgba(173,155,255,.16)") + '</div>');
    else if (action === "credits") openModal("Plans & generation credits", '<span class="badge badge-green">PROTOTYPE MODE</span><p>TESLAFIELD currently has no paid plans, credit balance or AI provider connected. Before accepting payments, the product needs real generation-cost estimates, billing infrastructure, terms, commercial-use rules and user protections.</p><p><strong>Recommended first step:</strong> launch the creative planning tools, validate demand, then connect one permitted image or video provider with clear per-generation pricing.</p>');
    else if (action === "notifications") openModal("Notifications", '<p>You are all caught up. Generation updates, project invitations and billing notifications will appear here after account services are connected.</p>');
    else if (action === "workspace") openModal("Workspace", '<p><strong>Personal workspace</strong><br>Free studio preview</p><p>Multi-user collaboration and team permissions are planned for a later release.</p>');
    else if (action === "profile") openModal("Creator account", '<p>Signed-in identity is not connected in this prototype. Authentication, account security and profile settings will be implemented with the backend.</p>');
    else if (action === "settings") openModal("Studio settings", '<p>Appearance: Dark studio theme<br>Workspace: Personal<br>Generation services: Not connected<br>Storage: Browser-only prototype state</p>');
    else if (action === "preview-reset") {
      var frame = document.getElementById("previewFrame");
      if (frame) frame.style.backgroundImage = "";
      uploadedFile = null;
      toast("Preview reset.", "↺");
    } else if (action === "add-shot") {
      shots.push({ name: String(shots.length + 1).padStart(2, "0") + " — New shot", detail: "Choose framing · Choose movement · Set duration", image: "linear-gradient(130deg,#4b5a70,#171d28)" });
      renderCurrentView();
      toast("Shot added to the sequence.", "＋");
    } else if (action === "remove-shot") {
      var shotIndex = Number(element.getAttribute("data-index"));
      if (shots.length <= 1) { toast("Keep at least one shot in your scene.", "!"); return; }
      shots.splice(shotIndex, 1);
      renderCurrentView();
    } else if (action === "edit-shot") {
      openModal("Edit shot", '<p>Shot ' + (Number(element.getAttribute("data-index")) + 1) + ' is part of your local storyboard. Detailed per-shot prompting and model settings will be connected in the production version.</p><div class="control-label">Shot direction</div><input class="field" id="editShotName" placeholder="Describe the camera and action">');
    } else if (action === "cinema-reset") {
      shots = [{ name: "01 — Establishing shot", detail: "Wide landscape · Slow push-in · 4 seconds", image: "linear-gradient(130deg,#52636c,#111923 65%)" }, { name: "02 — Hero reveal", detail: "Medium close-up · Orbit right · 3 seconds", image: "linear-gradient(130deg,#806b58,#211c20 65%)" }, { name: "03 — Final moment", detail: "Low angle · Dolly forward · 4 seconds", image: "linear-gradient(130deg,#485a83,#151a28 65%)" }];
      renderCurrentView();
      toast("Starter shot sequence restored.", "↺");
    } else if (action === "director-plan") planDirector();
    else if (action === "ad-generate") {
      var product = document.getElementById("productName");
      var brief = document.getElementById("productBrief");
      if (!product || !product.value.trim()) { toast("Add a product or campaign name first.", "!"); if (product) product.focus(); return; }
      var result = document.getElementById("adResult");
      if (result) {
        result.innerHTML = '<section class="panel" style="margin-top:15px"><div class="panel-title-row"><h3>Campaign outline / ' + esc(product.value.trim()) + '</h3><span>LOCAL TEMPLATE</span></div><div class="shot-list"><div class="shot-card"><div class="shot-visual" style="background:linear-gradient(130deg,#a27852,#26202a)"></div><div><strong>Hook — Stop the scroll</strong><small>Lead with the strongest product benefit in the first two seconds.</small></div></div><div class="shot-card"><div class="shot-visual" style="background:linear-gradient(130deg,#4e6470,#1b202a)"></div><div><strong>Proof — Show it in use</strong><small>Demonstrate the product experience with a clear visual detail.</small></div></div><div class="shot-card"><div class="shot-visual" style="background:linear-gradient(130deg,#63754f,#20261e)"></div><div><strong>Offer — Close with action</strong><small>Finish with one clear reason to act and a simple call to action.</small></div></div></div><p class="field-note">Campaign note: ' + esc(brief && brief.value ? brief.value.slice(0, 180) : "No product details supplied yet.") + '</p></section>';
        result.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      toast("Campaign outline created from a local template. No ad was generated.", "✦");
    } else if (action === "add-node") {
      var nodeTypes = [{ type: "AUDIO", name: "Sound design", description: "Add voice, music or sound effects." }, { type: "EDIT", name: "Finishing pass", description: "Prepare the final creative output." }, { type: "REFERENCE", name: "Reference library", description: "Bring in a saved image or asset." }];
      var next = nodeTypes[(canvasNodes.length - 3) % nodeTypes.length];
      canvasNodes.push(next);
      renderCurrentView();
      toast("A workflow node was added to the board.", "＋");
    } else if (action === "canvas-reset") {
      canvasNodes = [{ type: "INPUT", name: "Creative brief", description: "Describe the scene, product or story." }, { type: "IMAGE", name: "Visual direction", description: "Create a reference frame or moodboard." }, { type: "VIDEO", name: "Motion generation", description: "Animate the selected visual direction." }];
      renderCurrentView();
      toast("Canvas starter workflow restored.", "↺");
    } else if (action === "save-canvas") toast("Template saved in this browser session only.", "✓");
    else if (action === "run-canvas") toast("Workflow is not executable yet. Connect generation nodes and a backend to run it.", "!");
    else if (action === "save-character") {
      var name = document.getElementById("characterName");
      if (!name || !name.value.trim()) { toast("Give this character reference a name.", "!"); if (name) name.focus(); return; }
      var target = document.getElementById("characterResult");
      if (target) target.innerHTML = '<section class="panel" style="margin-top:15px"><span class="badge badge-green">SAVED IN THIS SESSION</span><h3 style="font:700 13px Manrope,sans-serif">' + esc(name.value.trim()) + '</h3><p class="page-subtitle">Your reference card is ready to organise. No identity training or facial recognition was performed.</p></section>';
      toast("Character reference card saved in this session.", "✓");
    } else if (action === "audio-generate") {
      var script = document.getElementById("audioScript");
      if (!script || !script.value.trim()) { toast("Write a short voiceover script first.", "!"); return; }
      toast("Audio brief saved as a planning note. No voice was generated.", "♫");
    } else if (action === "editor-export") openModal("Export settings", '<p>Video export will be enabled when the media pipeline is connected. Planned settings include aspect ratio, frame rate, resolution, audio mix and file format.</p><span class="badge">EXPORT NOT AVAILABLE IN DEMO</span>');
    else if (action === "copy-brief") {
      if (navigator.clipboard && window.lastBrief) navigator.clipboard.writeText(window.lastBrief).then(function () { toast("Creative brief copied.", "✓"); }).catch(function () { toast("Clipboard access is unavailable in this browser.", "!"); });
      else toast("No creative brief is available to copy.", "!");
    } else if (action === "close-modal") closeModal();
  }

  document.addEventListener("click", function (event) {
    var nav = event.target.closest("[data-view]");
    if (nav) {
      event.preventDefault();
      closeModal();
      openView(nav.getAttribute("data-view"));
      return;
    }
    var actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      event.preventDefault();
      handleAction(actionButton.getAttribute("data-action"), actionButton);
      return;
    }
    var choice = event.target.closest("[data-choice]");
    if (choice) {
      var parent = choice.parentElement;
      if (parent) parent.querySelectorAll("[data-choice]").forEach(function (node) { node.classList.toggle("selected", node === choice); });
    }
    var groupChoice = event.target.closest("[data-choice-group]");
    if (groupChoice) {
      var group = groupChoice.parentElement;
      if (group) group.querySelectorAll("[data-choice-group]").forEach(function (node) { node.classList.toggle("selected", node === groupChoice); });
    }
    var ratio = event.target.closest("[data-ratio]");
    if (ratio) {
      document.querySelectorAll("[data-ratio]").forEach(function (node) { node.classList.toggle("selected", node === ratio); });
      var frame = document.getElementById("previewFrame");
      if (frame) {
        frame.classList.remove("vertical", "square");
        if (ratio.getAttribute("data-ratio") === "9:16") frame.classList.add("vertical");
        if (ratio.getAttribute("data-ratio") === "1:1") frame.classList.add("square");
      }
    }
  });

  document.getElementById("menuButton").addEventListener("click", function () {
    sidebar.classList.add("open");
    scrim.classList.add("show");
  });
  scrim.addEventListener("click", closeSidebar);

  fileInput.addEventListener("change", function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    uploadedFile = file;
    var title = document.getElementById("uploadTitle") || document.getElementById("characterUploadTitle");
    var note = document.getElementById("uploadNote");
    if (title) title.textContent = file.name;
    if (note) note.textContent = "Selected locally · " + Math.max(1, Math.round(file.size / 1024)) + " KB";
    var hint = document.getElementById("previewHint");
    if (hint) hint.textContent = "Selected reference: " + file.name;
    if (file.type.indexOf("image/") === 0) {
      var reader = new FileReader();
      reader.onload = function (event) {
        var frame = document.getElementById("previewFrame");
        if (frame) frame.style.backgroundImage = "linear-gradient(0deg,rgba(0,0,0,.3),rgba(0,0,0,.08)),url('" + event.target.result + "')";
      };
      reader.readAsDataURL(file);
    }
    toast("Reference selected locally. It has not been uploaded to a server.", "✓");
  });

  var search = document.getElementById("globalSearch");
  search.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      searchQuery = search.value.trim();
      openView("library");
    }
    if (event.key === "Escape") {
      search.value = "";
      searchQuery = "";
      search.blur();
    }
  });
  search.addEventListener("input", function () {
    if (!search.value.trim() && currentView === "library") {
      searchQuery = "";
      renderCurrentView();
    }
  });
  document.addEventListener("keydown", function (event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      search.focus();
    }
    if (event.key === "Escape") {
      closeModal();
      closeSidebar();
    }
  });

  renderCurrentView();
  checkBackendConnection();
})();