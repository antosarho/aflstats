#!/usr/bin/env python3

from __future__ import annotations

import argparse
import html
import sqlite3
from collections import defaultdict
from pathlib import Path
from typing import Iterable


STAT_COLUMNS = [
    {
        "name": "kicks",
        "short": "K",
        "title": "Kicks",
        "description": "Kicks recorded in the stat sheet.",
    },
    {
        "name": "handballs",
        "short": "HB",
        "title": "Handballs",
        "description": "Handballs recorded in the stat sheet.",
    },
    {
        "name": "disposals",
        "short": "D",
        "title": "Disposals",
        "description": "Kicks plus handballs.",
    },
    {
        "name": "marks",
        "short": "M",
        "title": "Marks",
        "description": "Marks taken.",
    },
    {
        "name": "goals",
        "short": "G",
        "title": "Goals",
        "description": "Goals kicked.",
    },
    {
        "name": "behinds",
        "short": "B",
        "title": "Behinds",
        "description": "Behinds kicked.",
    },
    {
        "name": "tackles",
        "short": "T",
        "title": "Tackles",
        "description": "Tackles laid.",
    },
    {
        "name": "hit_outs",
        "short": "HO",
        "title": "Hit Outs",
        "description": "Hit outs recorded.",
    },
    {
        "name": "inside_50s",
        "short": "I50",
        "title": "Inside 50s",
        "description": "Inside-50 entries credited.",
    },
    {
        "name": "clearances",
        "short": "CL",
        "title": "Clearances",
        "description": "Centre and stoppage clearances combined.",
    },
    {
        "name": "rebound_50s",
        "short": "R50",
        "title": "Rebound 50s",
        "description": "Rebound-50s credited.",
    },
    {
        "name": "clangers",
        "short": "CG",
        "title": "Clangers",
        "description": "Clangers recorded.",
    },
    {
        "name": "frees_for",
        "short": "FF",
        "title": "Frees For",
        "description": "Free kicks received.",
    },
    {
        "name": "frees_against",
        "short": "FA",
        "title": "Frees Against",
        "description": "Free kicks conceded.",
    },
    {
        "name": "goal_assists",
        "short": "GA",
        "title": "Goal Assists",
        "description": "Goal assists credited.",
    },
    {
        "name": "afl_fantasy_score",
        "short": "AF",
        "title": "AFL Fantasy",
        "description": "AFL Fantasy points from FootyWire match pages.",
    },
    {
        "name": "supercoach_score",
        "short": "SC",
        "title": "SuperCoach",
        "description": "SuperCoach points from FootyWire match pages.",
    },
]

TEAM_THEMES = {
    "Adelaide": {"primary": "#002b5c", "secondary": "#c8102e", "accent": "#f2a900"},
    "Brisbane Bears": {"primary": "#7a263a", "secondary": "#00a3e0", "accent": "#f7a81b"},
    "Brisbane Lions": {"primary": "#7a263a", "secondary": "#0057b8", "accent": "#f7a81b"},
    "Carlton": {"primary": "#031a46", "secondary": "#7db7e8", "accent": "#ffffff"},
    "Collingwood": {"primary": "#111111", "secondary": "#ffffff", "accent": "#b3b3b3"},
    "Essendon": {"primary": "#1c1c1c", "secondary": "#d71920", "accent": "#b3b3b3"},
    "Fitzroy": {"primary": "#7b1e3a", "secondary": "#0057b8", "accent": "#f2a900"},
    "Footscray": {"primary": "#004b8d", "secondary": "#d71920", "accent": "#ffffff"},
    "Fremantle": {"primary": "#2b1447", "secondary": "#ffffff", "accent": "#8b5fbf"},
    "GW Sydney": {"primary": "#f15a22", "secondary": "#4a4a4a", "accent": "#ffffff"},
    "Geelong": {"primary": "#002b5c", "secondary": "#ffffff", "accent": "#7db7e8"},
    "Gold Coast": {"primary": "#d71920", "secondary": "#f2a900", "accent": "#ffffff"},
    "Hawthorn": {"primary": "#4b2e19", "secondary": "#f2a900", "accent": "#d8c19c"},
    "Kangaroos": {"primary": "#0b3b8c", "secondary": "#ffffff", "accent": "#8cc6ff"},
    "Melbourne": {"primary": "#0f2340", "secondary": "#c8102e", "accent": "#7db7e8"},
    "North Melbourne": {"primary": "#0b3b8c", "secondary": "#ffffff", "accent": "#8cc6ff"},
    "Port Adelaide": {"primary": "#111111", "secondary": "#00a0df", "accent": "#ffffff"},
    "Richmond": {"primary": "#111111", "secondary": "#f2c500", "accent": "#ffffff"},
    "South Melbourne": {"primary": "#c8102e", "secondary": "#ffffff", "accent": "#7db7e8"},
    "St Kilda": {"primary": "#111111", "secondary": "#d71920", "accent": "#ffffff"},
    "Sydney": {"primary": "#c8102e", "secondary": "#ffffff", "accent": "#7db7e8"},
    "University": {"primary": "#0f2340", "secondary": "#8cc6ff", "accent": "#ffffff"},
    "West Coast": {"primary": "#002b5c", "secondary": "#f2a900", "accent": "#ffffff"},
    "Western Bulldogs": {"primary": "#004b8d", "secondary": "#d71920", "accent": "#ffffff"},
}


def slugify(value: str) -> str:
    return (
        value.lower()
        .replace("&", "and")
        .replace(" ", "-")
        .replace(".", "")
        .replace("'", "")
    )


def player_page_filename(player_key: str, player_label: str) -> str:
    if player_key.startswith("p:"):
        return f"{slugify(player_label)}-p{player_key.split(':', 1)[1]}.html"
    return f"{slugify(player_label)}-{slugify(player_key.replace(':', '-'))}.html"


def team_theme_style(team_name: str | None) -> str:
    if not team_name or team_name not in TEAM_THEMES:
        return ""
    theme = TEAM_THEMES[team_name]
    primary = theme["primary"]
    secondary = theme["secondary"]
    accent = theme["accent"]
    return (
        ' style="--team-primary: {primary}; --team-secondary: {secondary}; '
        '--team-accent: {accent};"'.format(primary=primary, secondary=secondary, accent=accent)
    )


def esc(value: object) -> str:
    return html.escape("" if value is None else str(value))


def fmt_total(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return f"{value:.0f}"
    return str(value)


def fmt_avg(value: object) -> str:
    if value is None:
        return ""
    return f"{float(value):.2f}"


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def write_text(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def query_rows(conn: sqlite3.Connection, sql: str, params: Iterable[object] = ()) -> list[dict]:
    conn.row_factory = sqlite3.Row
    return [dict(row) for row in conn.execute(sql, tuple(params))]


def aggregate_exprs(alias: str, games_expr: str) -> str:
    parts = []
    for stat in STAT_COLUMNS:
        stat_name = stat["name"]
        parts.append(f"SUM(COALESCE({alias}.{stat_name}, 0)) AS {stat_name}_total")
        parts.append(
            "ROUND(CAST(SUM(COALESCE({alias}.{stat_name}, 0)) AS REAL) / NULLIF({games_expr}, 0), 2) "
            "AS {stat_name}_avg".format(alias=alias, stat_name=stat_name, games_expr=games_expr)
        )
    return ",\n                ".join(parts)


def page_template(title: str, body: str, root_prefix: str, intro: str = "", page_class: str = "", body_style: str = "") -> str:
    nav = (
        f'<nav class="site-nav"><a href="{root_prefix}index.html">Home</a>'
        f'<a href="{root_prefix}teams/index.html">Teams</a>'
        f'<a href="{root_prefix}years/index.html">Years</a>'
        f'<a href="{root_prefix}players/index.html">Players</a></nav>'
    )
    intro_block = f'<p class="page-intro">{intro}</p>' if intro else ""
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{esc(title)}</title>
  <link rel="stylesheet" href="{root_prefix}style.css">
  <script defer src="{root_prefix}app.js"></script>
</head>
<body class="{esc(page_class)}"{body_style}>
  <header class="site-header">
    <div class="header-inner">
      <h1>{esc(title)}</h1>
      {nav}
      {intro_block}
    </div>
  </header>
  <main>
    {body}
  </main>
</body>
</html>
"""


def list_page(items: list[tuple[str, str]], title: str) -> str:
    list_items = "".join(f'<li><a href="{href}">{esc(label)}</a></li>' for label, href in items)
    return f'<ul class="link-list">{list_items}</ul>'


def stat_picker_markup(table_id: str, include_games: bool = True) -> str:
    options = []
    if include_games:
        options.append(
            f'<label><input type="checkbox" data-column-picker="{table_id}" value="games" checked>Games</label>'
        )
    for stat in STAT_COLUMNS:
        options.append(
            f'<label><input type="checkbox" data-column-picker="{table_id}" value="{stat["name"]}_total" checked>'
            f'{esc(stat["title"])} total</label>'
        )
        options.append(
            f'<label><input type="checkbox" data-column-picker="{table_id}" value="{stat["name"]}_avg" checked>'
            f'{esc(stat["title"])} per game</label>'
        )
    option_html = "".join(options)
    return (
        '<details class="column-picker">'
        '<summary>Choose columns</summary>'
        f'<div class="column-picker-grid">{option_html}</div>'
        "</details>"
    )


def header_cell(label: str, title: str, description: str, sort_type: str, col_key: str) -> str:
    hover = esc(f"{title}: {description}")
    return (
        f'<th scope="col" data-sort-type="{sort_type}" data-col-key="{col_key}" title="{hover}">'
        f'<span class="th-label">{esc(label)}</span>'
        '<span class="sort-indicator" aria-hidden="true"></span>'
        "</th>"
    )


def label_cell(row: dict, label_key: str, link_template: str | None) -> str:
    label = esc(row[label_key])
    if link_template:
        label = f'<a href="{link_template.format(**row)}">{label}</a>'
    sort_value = esc(str(row[label_key]).lower())
    return f'<td data-col-key="label" data-sort-value="{sort_value}">{label}</td>'


def stats_table(
    rows: list[dict],
    label_key: str,
    label_title: str,
    table_id: str,
    link_template: str | None = None,
    notes: str = "",
) -> str:
    head_cells = [
        header_cell(label_title, label_title, f"Row label for this table.", "text", "label"),
        header_cell("Games", "Games", "Games included in the totals and per-game rates.", "numeric", "games"),
    ]
    for stat in STAT_COLUMNS:
        head_cells.append(
            header_cell(
                stat["short"],
                stat["title"],
                f"Total {stat['title'].lower()} across the included games. {stat['description']}",
                "numeric",
                f"{stat['name']}_total",
            )
        )
        head_cells.append(
            header_cell(
                f"{stat['short']}/G",
                f"{stat['title']} per Game",
                f"Average {stat['title'].lower()} per game across the included games. {stat['description']}",
                "numeric",
                f"{stat['name']}_avg",
            )
        )

    body_rows = []
    for row in rows:
        cells = [
            label_cell(row, label_key, link_template),
            f'<td data-col-key="games" data-sort-value="{esc(row["games"])}">{esc(row["games"])}</td>',
        ]
        for stat in STAT_COLUMNS:
            total_key = f'{stat["name"]}_total'
            avg_key = f'{stat["name"]}_avg'
            total_value = row.get(total_key)
            avg_value = row.get(avg_key)
            cells.append(
                f'<td data-col-key="{total_key}" data-sort-value="{esc(total_value if total_value is not None else "")}">'
                f"{fmt_total(total_value)}</td>"
            )
            cells.append(
                f'<td data-col-key="{avg_key}" data-sort-value="{esc(avg_value if avg_value is not None else "")}">'
                f"{fmt_avg(avg_value)}</td>"
            )
        body_rows.append("<tr>" + "".join(cells) + "</tr>")

    note_html = f'<p class="table-notes">{notes}</p>' if notes else ""
    return (
        '<section class="table-section">'
        '<div class="table-toolbar">'
        f'<label class="table-filter">Filter rows <input type="search" placeholder="Type to filter..." data-table-filter="{table_id}"></label>'
        '<div class="table-toolbar-actions">'
        f'<button type="button" data-columns-all="{table_id}">Show all columns</button>'
        f'<button type="button" data-columns-core="{table_id}">Core columns only</button>'
        "</div>"
        f"{stat_picker_markup(table_id)}"
        "</div>"
        f'{note_html}<div class="table-shell" data-table-shell="{table_id}">'
        '<div class="table-top-scroll" aria-hidden="true"><div class="table-top-scroll-inner"></div></div>'
        '<div class="table-wrap">'
        f'<table class="stats-table" data-table-id="{table_id}">'
        f"<thead><tr>{''.join(head_cells)}</tr></thead>"
        f"<tbody>{''.join(body_rows)}</tbody>"
        "</table></div>"
        '<div class="table-scroll-hint">Scroll sideways here. The top scrollbar stays above the table.</div>'
        "</div></section>"
    )


def section(title: str, body: str) -> str:
    return f"<section><h2>{esc(title)}</h2>{body}</section>"


def build_site(db_path: Path, out_dir: Path) -> None:
    ensure_dir(out_dir)
    ensure_dir(out_dir / "teams")
    ensure_dir(out_dir / "years")
    ensure_dir(out_dir / "players")
    ensure_dir(out_dir / "players" / "years")

    conn = sqlite3.connect(db_path)
    try:
        season_rows = query_rows(conn, "SELECT DISTINCT season FROM games ORDER BY season DESC")
        team_rows = query_rows(conn, "SELECT DISTINCT name AS team FROM teams ORDER BY name")
        player_game_count = query_rows(conn, "SELECT COUNT(*) AS n FROM player_appearances")[0]["n"]
        player_count = query_rows(conn, "SELECT COUNT(*) AS n FROM players")[0]["n"]

        home_team_links = [(row["team"], f'teams/{slugify(row["team"])}/index.html') for row in team_rows]
        home_year_links = [(str(row["season"]), f'years/{row["season"]}.html') for row in season_rows]

        home_body = (
            '<section><ul class="summary">'
            f"<li>Teams: {len(team_rows)}</li>"
            f"<li>Seasons: {len(season_rows)}</li>"
            f"<li>Players: {player_count}</li>"
            f"<li>Player appearances: {player_game_count}</li>"
            "</ul></section>"
            '<section class="columns">'
            f"<div><h2>Browse Teams</h2>{list_page(home_team_links, 'Teams')}</div>"
            f"<div><h2>Browse Years</h2>{list_page(home_year_links, 'Years')}</div>"
            '<div><h2>Player Leaderboards</h2>'
            '<ul class="link-list">'
            '<li><a href="players/all-time.html">All-time player stats</a></li>'
            '<li><a href="players/years/index.html">Player stats by season</a></li>'
            "</ul></div></section>"
        )
        write_text(
            out_dir / "index.html",
            page_template(
                "AFL Stats",
                home_body,
                "",
                intro="Raw-count and per-game stat tables generated from the SQLite database, now with sortable columns and player leaderboards.",
            ),
        )

        team_index_items = [(row["team"], f'{slugify(row["team"])}/index.html') for row in team_rows]
        write_text(
            out_dir / "teams" / "index.html",
            page_template(
                "Teams",
                list_page(team_index_items, "Teams"),
                "../",
                intro="Browse team pages, then drill into a season for player totals and per-game averages.",
            ),
        )

        year_index_items = [(str(row["season"]), f'{row["season"]}.html') for row in season_rows]
        write_text(
            out_dir / "years" / "index.html",
            page_template(
                "Years",
                list_page(year_index_items, "Years"),
                "../",
                intro="Browse each season to compare team totals and true team per-game averages.",
            ),
        )

        player_year_index_items = [(str(row["season"]), f'{row["season"]}.html') for row in season_rows]
        write_text(
            out_dir / "players" / "index.html",
            page_template(
                "Players",
                '<ul class="link-list">'
                '<li><a href="all-time.html">All-time player totals and per-game averages</a></li>'
                '<li><a href="years/index.html">Player leaderboards by season</a></li>'
                "</ul>",
                "../",
                intro="Sortable player leaderboards across all teams, with every raw total and per-game rate in one place. Click a player name from a table to open that player's page.",
            ),
        )
        write_text(
            out_dir / "players" / "years" / "index.html",
            page_template(
                "Player Seasons",
                list_page(player_year_index_items, "Player Seasons"),
                "../../",
                intro="Each season page lists players across the league, so you can sort by any total or per-game column.",
            ),
        )

        team_summary_sql = f"""
            SELECT
                pad.team AS label,
                pad.season AS season,
                COUNT(DISTINCT pad.game_id) AS games,
                {aggregate_exprs('pad', 'COUNT(DISTINCT pad.game_id)')}
            FROM player_appearance_details pad
            WHERE pad.team = ?
            GROUP BY pad.team, pad.season
            ORDER BY pad.season DESC
        """

        team_year_sql = f"""
            SELECT
                CASE
                    WHEN p.id IS NOT NULL THEN 'p:' || p.id
                    ELSE 'n:' || pad.player_name
                END AS player_key,
                COALESCE(p.name, pad.player_name) AS label,
                COUNT(*) AS games,
                {aggregate_exprs('pad', 'COUNT(*)')}
            FROM player_appearance_details pad
            LEFT JOIN players p ON p.id = pad.player_id
            WHERE pad.team = ? AND pad.season = ?
            GROUP BY player_key, label
            ORDER BY disposals_total DESC, games DESC, label
        """

        year_summary_sql = f"""
            SELECT
                pad.team AS label,
                COUNT(DISTINCT pad.game_id) AS games,
                {aggregate_exprs('pad', 'COUNT(DISTINCT pad.game_id)')}
            FROM player_appearance_details pad
            WHERE pad.season = ?
            GROUP BY pad.team
            ORDER BY pad.team
        """

        player_identity_select = """
                CASE
                    WHEN p.id IS NOT NULL THEN 'p:' || p.id
                    ELSE 'n:' || pad.player_name
                END AS player_key,
                COALESCE(p.name, pad.player_name) AS label
        """

        player_all_time_sql = f"""
            SELECT
                {player_identity_select},
                COUNT(*) AS games,
                {aggregate_exprs('pad', 'COUNT(*)')}
            FROM player_appearance_details pad
            LEFT JOIN players p ON p.id = pad.player_id
            GROUP BY player_key, label
            ORDER BY disposals_total DESC, games DESC, label
        """

        player_year_sql = f"""
            SELECT
                {player_identity_select},
                COUNT(*) AS games,
                {aggregate_exprs('pad', 'COUNT(*)')}
            FROM player_appearance_details pad
            LEFT JOIN players p ON p.id = pad.player_id
            WHERE pad.season = ?
            GROUP BY player_key, label
            ORDER BY disposals_total DESC, games DESC, label
        """

        player_season_summary_sql = f"""
            SELECT
                CASE
                    WHEN p.id IS NOT NULL THEN 'p:' || p.id
                    ELSE 'n:' || pad.player_name
                END AS player_key,
                CAST(pad.season AS TEXT) AS label,
                pad.season AS season,
                COUNT(*) AS games,
                {aggregate_exprs('pad', 'COUNT(*)')}
            FROM player_appearance_details pad
            LEFT JOIN players p ON p.id = pad.player_id
            GROUP BY player_key, pad.season
            ORDER BY player_key, pad.season DESC
        """

        player_team_summary_sql = f"""
            SELECT
                CASE
                    WHEN p.id IS NOT NULL THEN 'p:' || p.id
                    ELSE 'n:' || pad.player_name
                END AS player_key,
                pad.team AS label,
                COUNT(*) AS games,
                {aggregate_exprs('pad', 'COUNT(*)')}
            FROM player_appearance_details pad
            LEFT JOIN players p ON p.id = pad.player_id
            GROUP BY player_key, pad.team
            ORDER BY player_key, games DESC, label
        """

        player_team_season_summary_sql = f"""
            SELECT
                CASE
                    WHEN p.id IS NOT NULL THEN 'p:' || p.id
                    ELSE 'n:' || pad.player_name
                END AS player_key,
                pad.team || ' ' || pad.season AS label,
                pad.team AS team,
                pad.season AS season,
                COUNT(*) AS games,
                {aggregate_exprs('pad', 'COUNT(*)')}
            FROM player_appearance_details pad
            LEFT JOIN players p ON p.id = pad.player_id
            GROUP BY player_key, pad.team, pad.season
            ORDER BY player_key, pad.season DESC, games DESC, pad.team
        """

        for team_row in team_rows:
            team = team_row["team"]
            team_slug = slugify(team)
            team_dir = out_dir / "teams" / team_slug
            ensure_dir(team_dir)

            summary_rows = query_rows(conn, team_summary_sql, (team,))
            for row in summary_rows:
                row["label"] = str(row["season"])
                row["year_file"] = f"{row['season']}.html"

            summary_body = stats_table(
                summary_rows,
                "label",
                "Season",
                f"team-{team_slug}",
                link_template="{year_file}",
                notes="Per-game columns here are team totals divided by the number of games in that season.",
            )
            write_text(
                team_dir / "index.html",
                page_template(
                    f"{team} Stats",
                    summary_body,
                    "../../",
                    intro=f"{team} seasonal totals and true team per-game averages.",
                    page_class="team-page",
                    body_style=team_theme_style(team),
                ),
            )

            for row in summary_rows:
                season = row["season"]
                player_rows = query_rows(conn, team_year_sql, (team, season))
                for player_row in player_rows:
                    player_row["player_file"] = f'../../players/{player_page_filename(player_row["player_key"], player_row["label"])}'
                player_body = stats_table(
                    player_rows,
                    "label",
                    "Player",
                    f"team-{team_slug}-{season}",
                    link_template="{player_file}",
                    notes="Per-game columns here are player totals divided by the number of games that player appeared in for this team and season.",
                )
                write_text(
                    team_dir / f"{season}.html",
                    page_template(
                        f"{team} {season} Player Stats",
                        player_body,
                        "../../",
                        intro=f"{team} player totals and per-game averages for {season}.",
                        page_class="team-page",
                        body_style=team_theme_style(team),
                    ),
                )

        for season_row in season_rows:
            season = season_row["season"]
            season_rows_data = query_rows(conn, year_summary_sql, (season,))
            for row in season_rows_data:
                row["team_slug"] = slugify(row["label"])
                row["team_file"] = f"../teams/{row['team_slug']}/{season}.html"

            year_body = stats_table(
                season_rows_data,
                "label",
                "Team",
                f"year-{season}",
                link_template="{team_file}",
                notes="Per-game columns here are team totals divided by games played in that season.",
            )
            write_text(
                out_dir / "years" / f"{season}.html",
                page_template(
                    f"{season} Team Stats",
                    year_body,
                    "../",
                    intro=f"Team totals and true team per-game averages for the {season} season.",
                ),
            )

            player_year_rows = query_rows(conn, player_year_sql, (season,))
            for row in player_year_rows:
                row["player_file"] = player_page_filename(row["player_key"], row["label"])
            player_year_body = stats_table(
                player_year_rows,
                "label",
                "Player",
                f"players-year-{season}",
                link_template="../{player_file}",
                notes="Per-game columns here are player totals divided by that player's games in the selected season.",
            )
            write_text(
                out_dir / "players" / "years" / f"{season}.html",
                page_template(
                    f"{season} Player Stats",
                    player_year_body,
                    "../../",
                    intro=f"League-wide player totals and per-game averages for {season}.",
                ),
            )

        player_all_time_rows = query_rows(conn, player_all_time_sql)
        for row in player_all_time_rows:
            row["player_file"] = player_page_filename(row["player_key"], row["label"])
        player_all_time_body = stats_table(
            player_all_time_rows,
            "label",
            "Player",
            "players-all-time",
            link_template="{player_file}",
            notes="Per-game columns here are career totals divided by career games in the database.",
        )
        write_text(
            out_dir / "players" / "all-time.html",
            page_template(
                "All-time Player Stats",
                player_all_time_body,
                "../",
                intro="League-wide player leaderboards across the full database. Sort any column to find most kicks per game, most disposals overall, and more.",
            ),
        )

        player_meta_by_key = {
            row["player_key"]: row
            for row in query_rows(
                conn,
                """
                SELECT
                    'p:' || id AS player_key,
                    name,
                    birth_date,
                    height_cm,
                    weight_kg,
                    career_summary
                FROM players
                """,
            )
        }

        player_season_rows_by_key: dict[str, list[dict]] = defaultdict(list)
        for row in query_rows(conn, player_season_summary_sql):
            row["season_file"] = f'years/{row["season"]}.html'
            player_season_rows_by_key[row["player_key"]].append(row)

        player_team_rows_by_key: dict[str, list[dict]] = defaultdict(list)
        for row in query_rows(conn, player_team_summary_sql):
            player_team_rows_by_key[row["player_key"]].append(row)

        player_team_season_rows_by_key: dict[str, list[dict]] = defaultdict(list)
        for row in query_rows(conn, player_team_season_summary_sql):
            row["team_slug"] = slugify(row["team"])
            row["team_season_file"] = f'../teams/{row["team_slug"]}/{row["season"]}.html'
            player_team_season_rows_by_key[row["player_key"]].append(row)

        for player_row in player_all_time_rows:
            player_key = player_row["player_key"]
            player_name = player_row["label"]
            player_file = player_row["player_file"]

            season_rows = player_season_rows_by_key.get(player_key, [])
            team_rows = player_team_rows_by_key.get(player_key, [])
            team_season_rows = player_team_season_rows_by_key.get(player_key, [])

            meta = player_meta_by_key.get(player_key, {})
            summary_items = [f"Career games in DB: {esc(player_row['games'])}"]
            if meta.get("birth_date"):
                summary_items.append(f"Born: {esc(meta['birth_date'])}")
            if meta.get("height_cm"):
                summary_items.append(f"Height: {esc(meta['height_cm'])} cm")
            if meta.get("weight_kg"):
                summary_items.append(f"Weight: {esc(meta['weight_kg'])} kg")

            body = (
                '<ul class="summary">' + "".join(f"<li>{item}</li>" for item in summary_items) + "</ul>"
            )
            if meta.get("career_summary"):
                body += f'<p>{esc(meta["career_summary"])}</p>'

            body += section(
                "Career Totals",
                stats_table(
                    [player_row],
                    "label",
                    "Player",
                    f'player-career-{player_key.replace(":", "-")}',
                    notes="Career totals and per-game averages across every game for this player in the database.",
                ),
            )
            body += section(
                "By Season",
                stats_table(
                    season_rows,
                    "label",
                    "Season",
                    f'player-seasons-{player_key.replace(":", "-")}',
                    link_template="{season_file}",
                    notes="Per-game columns here are season totals divided by games played in that season.",
                ),
            )
            body += section(
                "By Team",
                stats_table(
                    team_rows,
                    "label",
                    "Team",
                    f'player-teams-{player_key.replace(":", "-")}',
                    notes="Per-game columns here are totals divided by games played for that team.",
                ),
            )
            body += section(
                "By Team and Season",
                stats_table(
                    team_season_rows,
                    "label",
                    "Team / Season",
                    f'player-team-seasons-{player_key.replace(":", "-")}',
                    link_template="{team_season_file}",
                    notes="Per-game columns here are totals divided by games played for that team in that season.",
                ),
            )

            write_text(
                out_dir / "players" / player_file,
                page_template(
                    f"{player_name} Stats",
                    body,
                    "../",
                    intro=f"Individual career, season, and team breakdowns for {player_name}.",
                ),
            )
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate raw HTML AFL stats pages from the SQLite database.")
    parser.add_argument("--db", default="../afltables_games.sqlite", help="Path to the SQLite database.")
    parser.add_argument("--out", default=".", help="Output directory for the static site.")
    args = parser.parse_args()

    build_site(Path(args.db), Path(args.out))


if __name__ == "__main__":
    main()
