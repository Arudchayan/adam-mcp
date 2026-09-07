/* Scripted adam-mcp chat demo — answers baked from fixture provider. */
const FIXTURE = {
  news: [
    {
      title: "New file in Course & Notes",
      summary: "00_Overview.pdf was added to 03 - Course & Notes.",
      url: "https://adam.unibas.ch/go/file/100011",
    },
    {
      title: "Seminar kickoff note",
      summary: "Welcome note posted before the overview PDF.",
      url: "https://adam.unibas.ch/go/crs/100001",
    },
  ],
  calendar: [
    { title: "Faculty briefing (calendar SoT)", when: "15 Sep 2026, 14:00–15:00 CEST", where: "Zoom (fixture)", url: "https://adam.unibas.ch/go/crs/100001", source: "calendar" },
    { title: "Exercise 1 – Retrieval summary", when: "due 22 Sep 2026, 23:59 CEST", where: "exc 100021 · labeled synthetic", url: "https://adam.unibas.ch/go/exc/100021", source: "exc" },
    { title: "Lab sheet 1 – Sorting warm-up", when: "due 5 Oct 2026, 23:59 CEST", where: "exc 100121", url: "https://adam.unibas.ch/go/exc/100121", source: "exc" },
    { title: "Written exam · Lecture Hall A", when: "12 Jan 2027, 10:00–12:00", where: "from course page", url: "https://adam.unibas.ch/go/crs/100001", source: "page" },
  ],
  searchHit: {
    title: "00000-01 – Synthetic Multimedia Seminar",
    url: "https://adam.unibas.ch/go/crs/100001",
    refId: "100001",
  },
  pageSummary: [
    "Week 3 reading: Fourier transforms and the DFT (see 00_Overview.pdf).",
    "Prepare the assigned reading before each session.",
    "Written exam: 12 January 2027, 10:00–12:00, Lecture Hall A.",
  ],
  exercise: {
    title: "Exercise 1 – Retrieval summary",
    url: "https://adam.unibas.ch/go/exc/100021",
    deadline: "22 Sep 2026, 23:59 CEST",
    note: "Labeled synthetic · connector cannot submit",
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (sel) => document.querySelector(sel);
const messages = () => $("#messages");

function scrollBottom() {
  const el = messages();
  el.scrollTop = el.scrollHeight;
}

function pruneOld(keep = 4) {
  const el = messages();
  const kids = [...el.children];
  // keep last N top-level nodes (rows/tools/endcard)
  while (kids.length > keep) {
    const n = kids.shift();
    n.remove();
  }
  scrollBottom();
}


function addUser(text) {
  const row = document.createElement("div");
  row.className = "row user";
  row.innerHTML = `<div class="avatar user">You</div><div class="bubble"></div>`;
  row.querySelector(".bubble").textContent = text;
  messages().appendChild(row);
  scrollBottom();
}

function addAssistant(html) {
  const row = document.createElement("div");
  row.className = "row assistant";
  row.innerHTML = `<div class="avatar ai">AI</div><div class="bubble">${html}</div>`;
  messages().appendChild(row);
  scrollBottom();
  return row;
}

function addTools(names) {
  const wrap = document.createElement("div");
  wrap.className = "tools";
  wrap.innerHTML = names
    .map((n) => `<div class="chip" data-tool="${n}"><span class="spin"></span>using ${n}…</div>`)
    .join("");
  messages().appendChild(wrap);
  scrollBottom();
  return wrap;
}

async function resolveTools(wrap) {
  for (const chip of wrap.querySelectorAll(".chip")) {
    await sleep(380);
    chip.classList.add("done");
    chip.childNodes[chip.childNodes.length - 1].textContent = chip.dataset.tool;
  }
  await sleep(550);
  wrap.classList.add("collapsing");
  for (const chip of wrap.querySelectorAll(".chip")) chip.classList.add("collapse");
  await sleep(450);
  wrap.remove();
}

async function typeInComposer(text, cps = 22) {
  const mirror = $("#input-mirror");
  const box = $(".composer-box");
  box.classList.add("has-text");
  mirror.classList.add("typing");
  mirror.textContent = "";
  for (const ch of text) {
    mirror.textContent += ch;
    await sleep(1000 / cps);
  }
  mirror.classList.remove("typing");
  await sleep(220);
  mirror.textContent = "";
  box.classList.remove("has-text");
}

async function runDemo() {
  // Establish
  await sleep(1200);
  addAssistant(`<strong>Connected to ADAM via adam-mcp.</strong><br/>Ask in plain language — I'll use the tools for you.`);
  await sleep(1800);

  // Beat 1 — news
  await sleep(800);
  await typeInComposer("What changed in my ADAM courses this week?");
  addUser("What changed in my ADAM courses this week?");
  await sleep(450);
  let tools = addTools(["adam_list_news"]);
  await sleep(1400);
  await resolveTools(tools);
  addAssistant(`
    <strong>Here’s what changed</strong> in enrolled courses with News on:
    <ul>
      <li><strong>${FIXTURE.news[0].title}</strong> — ${FIXTURE.news[0].summary}<br/><a href="${FIXTURE.news[0].url}">${FIXTURE.news[0].url}</a></li>
      <li><strong>${FIXTURE.news[1].title}</strong> — ${FIXTURE.news[1].summary}<br/><a href="${FIXTURE.news[1].url}">${FIXTURE.news[1].url}</a></li>
    </ul>
    <div class="meta"><span class="tag">fixture</span>provider=fixture · freshness=synthetic</div>
  `);
  await sleep(900);
  pruneOld(3);

  // Beat 2 — deadlines
  await sleep(1600);
  await typeInComposer("What's due?");
  addUser("What's due?");
  await sleep(400);
  tools = addTools(["adam_list_calendar"]);
  await sleep(1500);
  await resolveTools(tools);
  addAssistant(`
    <strong>Upcoming from calendar + exercises + pages:</strong>
    <ul>
      ${FIXTURE.calendar
        .map(
          (e) =>
            `<li><strong>${e.title}</strong> — ${e.when}${e.where ? ` · ${e.where}` : ""}<br/><a href="${e.url}">${e.url}</a> <span style="color:#8b9bb3;font-size:13px">(${e.source})</span></li>`,
        )
        .join("")}
    </ul>
    <div class="meta">Cited back to ADAM URLs · empty folders ≠ no deadlines</div>
  `);
  await sleep(900);
  pruneOld(3);

  // Beat 3 — Fourier search + page
  await sleep(1700);
  await typeInComposer("Find the Fourier reading and summarize the page");
  addUser("Find the Fourier reading and summarize the page");
  await sleep(400);
  tools = addTools(["adam_search", "adam_read_page"]);
  await sleep(1800);
  await resolveTools(tools);
  addAssistant(`
    <strong>Found</strong> <a href="${FIXTURE.searchHit.url}">${FIXTURE.searchHit.title}</a>
    <p style="margin-top:8px">Page summary (confirm gate passed):</p>
    <ul>
      ${FIXTURE.pageSummary.map((l) => `<li>${l}</li>`).join("")}
    </ul>
    <div class="meta">Search stayed on enrolled tree · catalog-only Fourier elective excluded</div>
  `);
  await sleep(900);
  pruneOld(3);

  // Beat 4 — brief exercise
  await sleep(1500);
  await typeInComposer("Show me exercise 100021");
  addUser("Show me exercise 100021");
  await sleep(400);
  tools = addTools(["adam_get_exercise"]);
  await sleep(1300);
  await resolveTools(tools);
  addAssistant(`
    <strong>${FIXTURE.exercise.title}</strong><br/>
    Deadline: <strong>${FIXTURE.exercise.deadline}</strong><br/>
    <a href="${FIXTURE.exercise.url}">${FIXTURE.exercise.url}</a>
    <div class="meta"><span class="tag">labeled synthetic</span>${FIXTURE.exercise.note}</div>
  `);
  await sleep(1000);
  pruneOld(2);

  // Trust + close inside chat
  await sleep(1200);
  const end = document.createElement("div");
  end.className = "endcard";
  end.innerHTML = `
    <h3>Local-first. Your session stays yours.</h3>
    <p>Runs on your machine. Uses your Chrome session. No cloud tunnel of your SWITCH login.</p>
    <p>Open source · not a University product · community Uni Basel student tool</p>
    <a class="gh" href="https://github.com/Arudchayan/adam-mcp">github.com/Arudchayan/adam-mcp →</a>
  `;
  messages().appendChild(end);
  scrollBottom();
  await sleep(5500);
  document.documentElement.dataset.demoDone = "1";
}

window.__adamDemo = { runDemo, FIXTURE };
if (new URLSearchParams(location.search).has("autoplay")) {
  runDemo();
}
