(function () {
  const STORAGE_PREFIX = "aflstats:";
  const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

  function storageKey(tableId, suffix) {
    return `${STORAGE_PREFIX}${suffix}:${tableId}`;
  }

  function readStorage(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  function parseNumeric(value) {
    if (value === null || value === undefined || value === "") {
      return Number.NEGATIVE_INFINITY;
    }
    const numeric = Number(value);
    return Number.isNaN(numeric) ? Number.NEGATIVE_INFINITY : numeric;
  }

  function stripHtml(value) {
    const temp = document.createElement("div");
    temp.innerHTML = value || "";
    return temp.textContent || temp.innerText || "";
  }

  function syncTopScrollbar(shell) {
    const top = shell.querySelector(".table-top-scroll");
    const topInner = shell.querySelector(".table-top-scroll-inner");
    const wrap = shell.querySelector(".table-wrap");
    if (!top || !topInner || !wrap) {
      return;
    }
    const resize = () => {
      topInner.style.width = `${wrap.scrollWidth}px`;
    };
    resize();
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
    window.addEventListener("resize", resize);
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
    } catch {
      frame.innerHTML = '<div class="player-photo-placeholder">Unable to load a public-domain photo right now.</div>';
      meta.textContent = "The Wikimedia Commons lookup failed for this page.";
    }
  }

  function parseExcludeYears(text) {
    const years = new Set();
    (text || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        if (part.includes("-")) {
          const [start, end] = part.split("-").map((value) => Number(value.trim()));
          if (!Number.isNaN(start) && !Number.isNaN(end)) {
            const lower = Math.min(start, end);
            const upper = Math.max(start, end);
            for (let year = lower; year <= upper; year += 1) {
              years.add(year);
            }
          }
        } else {
          const year = Number(part);
          if (!Number.isNaN(year)) {
            years.add(year);
          }
        }
      });
    return years;
  }

  function createRowModelFromDom(tr, columnKeys) {
    const cells = [...tr.children];
    const htmlByKey = {};
    const displayByKey = {};
    const sortByKey = {};
    cells.forEach((cell, index) => {
      const key = columnKeys[index];
      htmlByKey[key] = cell.innerHTML;
      displayByKey[key] = cell.textContent.trim();
      sortByKey[key] = cell.getAttribute("data-sort-value") || displayByKey[key];
    });
    return {
      key: sortByKey.label,
      htmlByKey,
      displayByKey,
      sortByKey,
      searchText: tr.textContent.toLowerCase(),
    };
  }

  function renderRowHtml(row, columnKeys) {
    return (
      "<tr>" +
      columnKeys
        .map((key) => {
          const value = row.htmlByKey[key] || "";
          const sortValue = row.sortByKey[key] ?? "";
          return `<td data-col-key="${key}" data-sort-value="${String(sortValue).replace(/"/g, "&quot;")}">${value}</td>`;
        })
        .join("") +
      "</tr>"
    );
  }

  function createAllTimeRowModel(player, stats, statNames) {
    const htmlByKey = {};
    const displayByKey = {};
    const sortByKey = {};
    htmlByKey.label = `<a href="${player.player_file}">${player.label}</a>`;
    displayByKey.label = player.label;
    sortByKey.label = player.label.toLowerCase();
    htmlByKey.games = String(stats.games);
    displayByKey.games = String(stats.games);
    sortByKey.games = stats.games;
    statNames.forEach((statName) => {
      const total = stats[`${statName}_total`] || 0;
      const avg = stats.games ? Number((total / stats.games).toFixed(2)) : 0;
      htmlByKey[`${statName}_total`] = String(Math.round(total));
      displayByKey[`${statName}_total`] = htmlByKey[`${statName}_total`];
      sortByKey[`${statName}_total`] = total;
      htmlByKey[`${statName}_avg`] = avg.toFixed(2);
      displayByKey[`${statName}_avg`] = htmlByKey[`${statName}_avg`];
      sortByKey[`${statName}_avg`] = avg;
    });
    return {
      key: player.player_key,
      htmlByKey,
      displayByKey,
      sortByKey,
      searchText: player.label.toLowerCase(),
    };
  }

  class StatsTableController {
    constructor(shell) {
      this.shell = shell;
      this.table = shell.querySelector("table[data-table-id]");
      this.tbody = this.table.querySelector("tbody");
      this.tableId = this.table.getAttribute("data-table-id");
      this.pageSize = Number(this.table.getAttribute("data-page-size") || "1000");
      this.tableKind = this.table.getAttribute("data-table-kind") || "";
      this.statNames = JSON.parse(this.table.getAttribute("data-stat-names") || "[]");
      this.columnKeys = [...this.table.querySelectorAll("thead th")].map((th) => th.getAttribute("data-col-key"));
      this.headers = [...this.table.querySelectorAll("thead th")];
      this.filterInput = document.querySelector(`[data-table-filter="${this.tableId}"]`);
      this.summaryTop = document.querySelector(`[data-table-summary-top="${this.tableId}"]`);
      this.summaryBottom = document.querySelector(`[data-table-summary-bottom="${this.tableId}"]`);
      this.pagination = document.querySelector(`[data-table-pagination="${this.tableId}"]`);
      this.hiddenColumns = new Set(readStorage(storageKey(this.tableId, "hidden-columns"), []));
      this.viewMode = readStorage(storageKey(this.tableId, "view-mode"), "both");
      this.fullWidth = readStorage(storageKey(this.tableId, "table-width"), false);
      this.currentPage = readStorage(storageKey(this.tableId, "page"), 1);
      this.sortKey = readStorage(storageKey(this.tableId, "sort-key"), "label");
      this.sortDirection = readStorage(storageKey(this.tableId, "sort-direction"), "asc");
      this.rowModels = [...this.tbody.querySelectorAll("tr")].map((tr) => createRowModelFromDom(tr, this.columnKeys));
      this.filteredRows = [...this.rowModels];
      this.allTimeData = null;
      this.bind();
      this.applyWidthMode();
      this.applyColumnVisibility();
      this.render();
      if (this.tableKind === "alltime-player") {
        this.initAllTimeFilters();
      }
    }

    bind() {
      syncTopScrollbar(this.shell);
      this.headers.forEach((header) => {
        header.tabIndex = 0;
        header.setAttribute("role", "button");
        header.setAttribute("aria-sort", "none");
        const key = header.getAttribute("data-col-key");
        const toggleSort = () => {
          if (this.sortKey === key) {
            this.sortDirection = this.sortDirection === "desc" ? "asc" : "desc";
          } else {
            this.sortKey = key;
            this.sortDirection = key === "label" ? "asc" : "desc";
          }
          writeStorage(storageKey(this.tableId, "sort-key"), this.sortKey);
          writeStorage(storageKey(this.tableId, "sort-direction"), this.sortDirection);
          this.render();
        };
        header.addEventListener("click", toggleSort);
        header.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleSort();
          }
        });
      });

      if (this.filterInput) {
        this.filterInput.addEventListener("input", () => {
          this.currentPage = 1;
          this.render();
        });
      }

      const allButton = document.querySelector(`[data-columns-all="${this.tableId}"]`);
      if (allButton) {
        allButton.addEventListener("click", () => {
          this.hiddenColumns.clear();
          this.saveHiddenColumns();
          this.applyColumnVisibility();
          this.renderSummaries();
        });
      }

      const coreButton = document.querySelector(`[data-columns-core="${this.tableId}"]`);
      if (coreButton) {
        coreButton.addEventListener("click", () => {
          this.hiddenColumns.clear();
          this.columnKeys.forEach((key) => {
            if (
              key !== "label" &&
              key !== "games" &&
              !key.endsWith("_total") &&
              key !== "disposals_avg" &&
              key !== "goals_avg" &&
              key !== "afl_fantasy_score_avg" &&
              key !== "supercoach_score_avg"
            ) {
              this.hiddenColumns.add(key);
            }
          });
          this.saveHiddenColumns();
          this.applyColumnVisibility();
          this.renderSummaries();
        });
      }

      document.querySelectorAll(`[data-column-picker="${this.tableId}"]`).forEach((input) => {
        input.addEventListener("change", () => {
          if (input.checked) {
            this.hiddenColumns.delete(input.value);
          } else {
            this.hiddenColumns.add(input.value);
          }
          this.saveHiddenColumns();
          this.applyColumnVisibility();
          this.renderSummaries();
        });
      });

      const widthButton = document.querySelector(`[data-table-width-toggle="${this.tableId}"]`);
      if (widthButton) {
        widthButton.addEventListener("click", () => {
          this.fullWidth = !this.fullWidth;
          writeStorage(storageKey(this.tableId, "table-width"), this.fullWidth);
          this.applyWidthMode();
        });
      }

      const statViewButton = document.querySelector(`[data-stat-view-toggle="${this.tableId}"]`);
      if (statViewButton) {
        statViewButton.addEventListener("click", () => {
          const order = ["both", "totals", "averages"];
          const currentIndex = order.indexOf(this.viewMode);
          this.viewMode = order[(currentIndex + 1) % order.length];
          writeStorage(storageKey(this.tableId, "view-mode"), this.viewMode);
          this.applyColumnVisibility();
          this.renderSummaries();
        });
      }
    }

    saveHiddenColumns() {
      writeStorage(storageKey(this.tableId, "hidden-columns"), [...this.hiddenColumns]);
    }

    applyWidthMode() {
      this.shell.classList.toggle("table-shell-wide", this.fullWidth);
      const button = document.querySelector(`[data-table-width-toggle="${this.tableId}"]`);
      if (button) {
        button.textContent = this.fullWidth ? "Narrower" : "Full width";
      }
    }

    isColumnVisible(key) {
      if (key === "label" || key === "games") {
        return !this.hiddenColumns.has(key);
      }
      if (this.hiddenColumns.has(key)) {
        return false;
      }
      if (this.viewMode === "totals" && key.endsWith("_avg")) {
        return false;
      }
      if (this.viewMode === "averages" && key.endsWith("_total")) {
        return false;
      }
      return true;
    }

    applyColumnVisibility() {
      this.table.querySelectorAll("[data-col-key]").forEach((cell) => {
        const key = cell.getAttribute("data-col-key");
        cell.classList.toggle("is-hidden", !this.isColumnVisible(key));
      });
      document.querySelectorAll(`[data-column-picker="${this.tableId}"]`).forEach((input) => {
        input.checked = !this.hiddenColumns.has(input.value);
      });
      const statViewButton = document.querySelector(`[data-stat-view-toggle="${this.tableId}"]`);
      if (statViewButton) {
        const labels = {
          both: "Totals + averages",
          totals: "Totals only",
          averages: "Averages only",
        };
        statViewButton.textContent = labels[this.viewMode];
      }
    }

    getFilteredRows() {
      const needle = (this.filterInput?.value || "").trim().toLowerCase();
      let rows = [...this.rowModels];
      if (needle) {
        rows = rows.filter((row) => row.searchText.includes(needle));
      }
      rows.sort((a, b) => {
        const aValue = a.sortByKey[this.sortKey];
        const bValue = b.sortByKey[this.sortKey];
        const header = this.table.querySelector(`thead th[data-col-key="${this.sortKey}"]`);
        const type = header?.getAttribute("data-sort-type") || "text";
        let comparison = 0;
        if (type === "numeric") {
          comparison = parseNumeric(aValue) - parseNumeric(bValue);
        } else {
          comparison = String(aValue).localeCompare(String(bValue), undefined, { sensitivity: "base" });
        }
        if (comparison === 0) {
          comparison = String(a.sortByKey.label).localeCompare(String(b.sortByKey.label), undefined, { sensitivity: "base" });
        }
        return this.sortDirection === "asc" ? comparison : -comparison;
      });
      return rows;
    }

    renderPagination(totalRows) {
      const totalPages = Math.max(1, Math.ceil(totalRows / this.pageSize));
      if (this.currentPage > totalPages) {
        this.currentPage = totalPages;
      }
      writeStorage(storageKey(this.tableId, "page"), this.currentPage);
      if (!this.pagination) {
        return;
      }
      this.pagination.innerHTML = `
        <button type="button" data-page-action="prev" ${this.currentPage <= 1 ? "disabled" : ""}>Previous</button>
        <span>Page ${this.currentPage} of ${totalPages} · ${totalRows} rows · ${Math.min(this.pageSize, totalRows || this.pageSize)} max rows per page</span>
        <button type="button" data-page-action="next" ${this.currentPage >= totalPages ? "disabled" : ""}>Next</button>
      `;
      this.pagination.querySelector('[data-page-action="prev"]')?.addEventListener("click", () => {
        if (this.currentPage > 1) {
          this.currentPage -= 1;
          this.render();
        }
      });
      this.pagination.querySelector('[data-page-action="next"]')?.addEventListener("click", () => {
        if (this.currentPage < totalPages) {
          this.currentPage += 1;
          this.render();
        }
      });
    }

    renderSummaries() {
      const visibleRows = this.filteredRows;
      const pageStart = (this.currentPage - 1) * this.pageSize;
      const pageRows = visibleRows.slice(pageStart, pageStart + this.pageSize);
      const visibleKeys = this.columnKeys.filter((key) => this.isColumnVisible(key) && key !== "label");
      const summaryBits = [
        `<strong>Rows</strong> ${pageRows.length} on this page / ${visibleRows.length} matching / ${this.rowModels.length} total`,
      ];
      if (visibleKeys.includes("games")) {
        const gamesTotal = pageRows.reduce((sum, row) => sum + parseNumeric(row.sortByKey.games), 0);
        summaryBits.push(`<strong>Games</strong> ${gamesTotal}`);
      }
      const extraKeys = visibleKeys.filter((key) => key !== "games").slice(0, 4);
      extraKeys.forEach((key) => {
        const values = pageRows.map((row) => parseNumeric(row.sortByKey[key])).filter((value) => Number.isFinite(value));
        if (!values.length) {
          return;
        }
        const aggregate = key.endsWith("_avg")
          ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)
          : Math.round(values.reduce((sum, value) => sum + value, 0));
        summaryBits.push(`<strong>${key.replace(/_/g, " ")}</strong> ${aggregate}`);
      });
      const html = `<div class="summary-chips">${summaryBits.map((bit) => `<span class="summary-chip">${bit}</span>`).join("")}</div>`;
      if (this.summaryTop) {
        this.summaryTop.innerHTML = html;
      }
      if (this.summaryBottom) {
        this.summaryBottom.innerHTML = html;
      }
    }

    render() {
      this.headers.forEach((header) => {
        const isActive = header.getAttribute("data-col-key") === this.sortKey;
        header.setAttribute(
          "aria-sort",
          isActive ? (this.sortDirection === "asc" ? "ascending" : "descending") : "none"
        );
      });
      this.filteredRows = this.getFilteredRows();
      const pageStart = (this.currentPage - 1) * this.pageSize;
      const pageRows = this.filteredRows.slice(pageStart, pageStart + this.pageSize);
      this.tbody.innerHTML = pageRows.map((row) => renderRowHtml(row, this.columnKeys)).join("");
      this.applyColumnVisibility();
      this.renderPagination(this.filteredRows.length);
      this.renderSummaries();
      const wrap = this.shell.querySelector(".table-wrap");
      if (wrap) {
        const topInner = this.shell.querySelector(".table-top-scroll-inner");
        if (topInner) {
          topInner.style.width = `${wrap.scrollWidth}px`;
        }
      }
    }

    async initAllTimeFilters() {
      const fromInput = this.shell.querySelector("[data-alltime-from]");
      const toInput = this.shell.querySelector("[data-alltime-to]");
      const excludeInput = this.shell.querySelector("[data-alltime-exclude]");
      const teamInputs = [...this.shell.querySelectorAll("[data-alltime-team]")];
      const clearButton = this.shell.querySelector("[data-alltime-clear]");
      const saved = readStorage(storageKey(this.tableId, "alltime-filters"), {
        from: "",
        to: "",
        exclude: "",
        teams: [],
      });
      if (fromInput) fromInput.value = saved.from;
      if (toInput) toInput.value = saved.to;
      if (excludeInput) excludeInput.value = saved.exclude;
      teamInputs.forEach((input) => {
        input.checked = saved.teams.includes(input.value);
      });

      const response = await fetch("all-time-filters.json");
      this.allTimeData = await response.json();

      const applyFilters = () => {
        const filterState = {
          from: fromInput?.value || "",
          to: toInput?.value || "",
          exclude: excludeInput?.value || "",
          teams: teamInputs.filter((input) => input.checked).map((input) => input.value),
        };
        writeStorage(storageKey(this.tableId, "alltime-filters"), filterState);
        this.rebuildAllTimeRows(filterState);
      };

      [fromInput, toInput, excludeInput].forEach((input) => {
        input?.addEventListener("input", () => {
          this.currentPage = 1;
          applyFilters();
        });
      });
      teamInputs.forEach((input) => {
        input.addEventListener("change", () => {
          this.currentPage = 1;
          applyFilters();
        });
      });
      clearButton?.addEventListener("click", () => {
        if (fromInput) fromInput.value = "";
        if (toInput) toInput.value = "";
        if (excludeInput) excludeInput.value = "";
        teamInputs.forEach((input) => {
          input.checked = false;
        });
        this.currentPage = 1;
        applyFilters();
      });

      applyFilters();
    }

    rebuildAllTimeRows(filterState) {
      if (!this.allTimeData) {
        return;
      }
      const excludedYears = parseExcludeYears(filterState.exclude);
      const fromYear = Number(filterState.from);
      const toYear = Number(filterState.to);
      const teamSet = new Set(filterState.teams);
      const playersByKey = new Map(this.allTimeData.players.map((player) => [player.player_key, player]));
      const aggregates = new Map();

      this.allTimeData.splits.forEach((split) => {
        if (!Number.isNaN(fromYear) && split.season < fromYear) {
          return;
        }
        if (!Number.isNaN(toYear) && split.season > toYear) {
          return;
        }
        if (excludedYears.has(split.season)) {
          return;
        }
        if (teamSet.size && !teamSet.has(split.team)) {
          return;
        }
        if (!aggregates.has(split.player_key)) {
          const base = { games: 0 };
          this.statNames.forEach((name) => {
            base[`${name}_total`] = 0;
          });
          aggregates.set(split.player_key, base);
        }
        const target = aggregates.get(split.player_key);
        target.games += split.games;
        this.statNames.forEach((name) => {
          target[`${name}_total`] += split[`${name}_total`] || 0;
        });
      });

      this.rowModels = [...aggregates.entries()]
        .map(([playerKey, stats]) => {
          const player = playersByKey.get(playerKey);
          if (!player || stats.games <= 0) {
            return null;
          }
          return createAllTimeRowModel(player, stats, this.statNames);
        })
        .filter(Boolean);
      this.render();
    }
  }

  function setupGlobalLayoutToggle() {
    const key = `${STORAGE_PREFIX}layout-wide`;
    let wide = readStorage(key, false);
    const apply = () => {
      document.body.classList.toggle("layout-wide", wide);
      document.querySelectorAll("[data-layout-toggle]").forEach((button) => {
        button.textContent = wide ? "Narrow width" : "Full width";
      });
    };
    document.querySelectorAll("[data-layout-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        wide = !wide;
        writeStorage(key, wide);
        apply();
      });
    });
    apply();
  }

  setupGlobalLayoutToggle();

  document.querySelectorAll(".table-shell").forEach((shell) => {
    new StatsTableController(shell);
  });

  document.querySelectorAll("[data-player-photo]").forEach((card) => {
    loadPlayerPhoto(card);
  });
})();
