(function () {
  const STORAGE_PREFIX = "aflstats:hidden-columns:";
  const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

  function parseNumeric(value) {
    if (value === null || value === undefined || value === "") {
      return Number.NEGATIVE_INFINITY;
    }
    const numeric = Number(value);
    return Number.isNaN(numeric) ? Number.NEGATIVE_INFINITY : numeric;
  }

  function applyColumnVisibility(table, tableId) {
    const hidden = new Set(
      JSON.parse(window.localStorage.getItem(STORAGE_PREFIX + tableId) || "[]")
    );
    table.querySelectorAll("[data-col-key]").forEach((cell) => {
      const key = cell.getAttribute("data-col-key");
      const shouldHide = key !== "label" && hidden.has(key);
      cell.classList.toggle("is-hidden", shouldHide);
    });
    document
      .querySelectorAll(`[data-column-picker="${tableId}"]`)
      .forEach((input) => {
        input.checked = !hidden.has(input.value);
      });
  }

  function saveHiddenColumns(tableId, hidden) {
    window.localStorage.setItem(STORAGE_PREFIX + tableId, JSON.stringify([...hidden]));
  }

  function syncTopScrollbar(shell) {
    const top = shell.querySelector(".table-top-scroll");
    const topInner = shell.querySelector(".table-top-scroll-inner");
    const wrap = shell.querySelector(".table-wrap");
    if (!top || !topInner || !wrap) {
      return;
    }
    topInner.style.width = `${wrap.scrollWidth}px`;
    let syncing = false;
    top.addEventListener("scroll", () => {
      if (syncing) {
        return;
      }
      syncing = true;
      wrap.scrollLeft = top.scrollLeft;
      syncing = false;
    });
    wrap.addEventListener("scroll", () => {
      if (syncing) {
        return;
      }
      syncing = true;
      top.scrollLeft = wrap.scrollLeft;
      syncing = false;
    });
    window.addEventListener("resize", () => {
      topInner.style.width = `${wrap.scrollWidth}px`;
    });
  }

  function setupSorting(table) {
    const headers = [...table.querySelectorAll("thead th")];
    const tbody = table.querySelector("tbody");
    const state = { key: null, direction: "desc" };

    headers.forEach((header, index) => {
      header.tabIndex = 0;
      header.setAttribute("role", "button");
      header.setAttribute("aria-sort", "none");
      const runSort = () => {
        const type = header.getAttribute("data-sort-type") || "text";
        const nextDirection =
          state.key === index && state.direction === "desc" ? "asc" : "desc";
        state.key = index;
        state.direction = nextDirection;

        headers.forEach((item) => item.setAttribute("aria-sort", "none"));
        header.setAttribute(
          "aria-sort",
          nextDirection === "asc" ? "ascending" : "descending"
        );

        const rows = [...tbody.querySelectorAll("tr")];
        rows.sort((a, b) => {
          const aCell = a.children[index];
          const bCell = b.children[index];
          const aValue = aCell.getAttribute("data-sort-value") || aCell.textContent.trim();
          const bValue = bCell.getAttribute("data-sort-value") || bCell.textContent.trim();
          let comparison = 0;
          if (type === "numeric") {
            comparison = parseNumeric(aValue) - parseNumeric(bValue);
          } else {
            comparison = aValue.localeCompare(bValue, undefined, { sensitivity: "base" });
          }
          return nextDirection === "asc" ? comparison : -comparison;
        });
        tbody.append(...rows);
      };

      header.addEventListener("click", runSort);
      header.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          runSort();
        }
      });
    });
  }

  function setupFilter(table, tableId) {
    const filterInput = document.querySelector(`[data-table-filter="${tableId}"]`);
    if (!filterInput) {
      return;
    }
    filterInput.addEventListener("input", () => {
      const needle = filterInput.value.trim().toLowerCase();
      table.querySelectorAll("tbody tr").forEach((row) => {
        const text = row.textContent.toLowerCase();
        row.classList.toggle("is-filtered-out", needle !== "" && !text.includes(needle));
      });
    });
  }

  function setupColumnPicker(table, tableId) {
    const inputs = [...document.querySelectorAll(`[data-column-picker="${tableId}"]`)];
    const hidden = new Set(
      JSON.parse(window.localStorage.getItem(STORAGE_PREFIX + tableId) || "[]")
    );

    function setColumns(hiddenSet) {
      saveHiddenColumns(tableId, hiddenSet);
      applyColumnVisibility(table, tableId);
    }

    inputs.forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) {
          hidden.delete(input.value);
        } else {
          hidden.add(input.value);
        }
        setColumns(hidden);
      });
    });

    const allButton = document.querySelector(`[data-columns-all="${tableId}"]`);
    if (allButton) {
      allButton.addEventListener("click", () => {
        hidden.clear();
        setColumns(hidden);
      });
    }

    const coreButton = document.querySelector(`[data-columns-core="${tableId}"]`);
    if (coreButton) {
      coreButton.addEventListener("click", () => {
        hidden.clear();
        table.querySelectorAll("[data-col-key]").forEach((cell) => {
          const key = cell.getAttribute("data-col-key");
          if (
            key !== "label" &&
            key !== "games" &&
            !key.endsWith("_total") &&
            key !== "disposals_avg" &&
            key !== "goals_avg" &&
            key !== "afl_fantasy_score_avg" &&
            key !== "supercoach_score_avg"
          ) {
            hidden.add(key);
          }
        });
        setColumns(hidden);
      });
    }

    applyColumnVisibility(table, tableId);
  }

  function stripHtml(value) {
    const temp = document.createElement("div");
    temp.innerHTML = value || "";
    return temp.textContent || temp.innerText || "";
  }

  function isPublicDomain(extmetadata) {
    const values = [
      extmetadata?.LicenseShortName?.value,
      extmetadata?.UsageTerms?.value,
      extmetadata?.License?.value,
      extmetadata?.Copyrighted?.value,
    ]
      .filter(Boolean)
      .map((value) => stripHtml(value).toLowerCase());

    return values.some(
      (value) =>
        value.includes("public domain") ||
        value.includes("cc0") ||
        value === "pd" ||
        value.startsWith("pd ")
    );
  }

  function scoreCommonsCandidate(page, playerName) {
    const title = (page.title || "").replace(/^File:/i, "").toLowerCase();
    const name = playerName.toLowerCase();
    const tokens = name.split(/\s+/).filter((token) => token.length > 2);
    let score = 0;
    if (title.includes(name)) {
      score += 10;
    }
    tokens.forEach((token) => {
      if (title.includes(token)) {
        score += 2;
      }
    });
    if (/\bportrait\b|\bheadshot\b|\bphoto\b/.test(title)) {
      score += 2;
    }
    return score;
  }

  async function loadPlayerPhoto(card) {
    const frame = card.querySelector("[data-player-photo-frame]");
    const meta = card.querySelector("[data-player-photo-meta]");
    const playerName = frame?.getAttribute("data-player-name");
    if (!frame || !meta || !playerName) {
      return;
    }

    try {
      const params = new URLSearchParams({
        action: "query",
        generator: "search",
        gsrsearch: `intitle:"${playerName}"`,
        gsrnamespace: "6",
        gsrlimit: "8",
        prop: "imageinfo",
        iiprop: "url|extmetadata",
        iiurlwidth: "260",
        format: "json",
        origin: "*",
      });
      const response = await fetch(`${COMMONS_API}?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      const pages = Object.values(payload.query?.pages || {});
      const candidates = pages
        .map((page) => {
          const imageinfo = page.imageinfo?.[0];
          return { page, imageinfo, score: scoreCommonsCandidate(page, playerName) };
        })
        .filter(({ imageinfo, score }) => imageinfo?.thumburl && isPublicDomain(imageinfo.extmetadata) && score > 0)
        .sort((a, b) => b.score - a.score);

      if (!candidates.length) {
        frame.innerHTML = '<div class="player-photo-placeholder">No public-domain photo found on Wikimedia Commons for this player.</div>';
        meta.textContent = "No public-domain Commons image was confidently matched for this page.";
        return;
      }

      const best = candidates[0];
      const description = stripHtml(best.imageinfo.extmetadata?.ImageDescription?.value || "");
      const license = stripHtml(
        best.imageinfo.extmetadata?.LicenseShortName?.value ||
        best.imageinfo.extmetadata?.UsageTerms?.value ||
        "Public domain"
      );
      const fileUrl = `https://commons.wikimedia.org/wiki/${encodeURIComponent(best.page.title.replace(/ /g, "_"))}`;

      frame.innerHTML =
        `<a href="${fileUrl}" target="_blank" rel="noopener noreferrer">` +
        `<img src="${best.imageinfo.thumburl}" alt="${playerName}" loading="lazy"></a>`;
      meta.innerHTML =
        `${description ? `${description}. ` : ""}` +
        `Source: <a href="${fileUrl}" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>. ` +
        `License: ${license}.`;
    } catch (error) {
      frame.innerHTML = '<div class="player-photo-placeholder">Unable to load a public-domain photo right now.</div>';
      meta.textContent = "The Wikimedia Commons lookup failed for this page.";
    }
  }

  document.querySelectorAll(".table-shell").forEach((shell) => {
    const table = shell.querySelector("table[data-table-id]");
    if (!table) {
      return;
    }
    const tableId = table.getAttribute("data-table-id");
    syncTopScrollbar(shell);
    setupSorting(table);
    setupFilter(table, tableId);
    setupColumnPicker(table, tableId);
  });

  document.querySelectorAll("[data-player-photo]").forEach((card) => {
    loadPlayerPhoto(card);
  });
})();
