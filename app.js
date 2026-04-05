(function () {
  const STORAGE_PREFIX = "aflstats:hidden-columns:";

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
})();
