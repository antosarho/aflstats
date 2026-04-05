#!/usr/bin/env python3

from __future__ import annotations

import argparse
import html
import sqlite3
from pathlib import Path
from typing import Iterable


STAT_COLUMNS = [
    ("kicks", "K"),
    ("handballs", "HB"),
    ("disposals", "D"),
    ("marks", "M"),
    ("goals", "G"),
    ("behinds", "B"),
    ("tackles", "T"),
    ("hit_outs", "HO"),
    ("inside_50s", "I50"),
    ("clearances", "CL"),
    ("rebound_50s", "R50"),
    ("clangers", "CG"),
    ("frees_for", "FF"),
    ("frees_against", "FA"),
    ("goal_assists", "GA"),
    ("afl_fantasy_score", "AF"),
    ("supercoach_score", "SC"),
]


def slugify(value: str) -> str:
    return (
        value.lower()
        .replace("&", "and")
        .replace(" ", "-")
        .replace(".", "")
        .replace("'", "")
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


def page_template(title: str, body: str, root_prefix: str) -> str:
    nav = (
        f'<nav><a href="{root_prefix}index.html">Home</a> '
        f'<a href="{root_prefix}teams/index.html">Teams</a> '
        f'<a href="{root_prefix}years/index.html">Years</a></nav>'
    )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{esc(title)}</title>
  <link rel="stylesheet" href="{root_prefix}style.css">
</head>
<body>
  <header>
    <h1>{esc(title)}</h1>
    {nav}
  </header>
  <main>
    {body}
  </main>
</body>
</html>
"""


def stats_table(rows: list[dict], label_key: str, label_title: str, link_prefix: str | None = None) -> str:
    head_cells = [f"<th>{esc(label_title)}</th>", "<th>Games</th>"]
    for _, short_label in STAT_COLUMNS:
        head_cells.append(f"<th>{esc(short_label)}</th>")
        head_cells.append(f"<th>{esc(short_label)}/G</th>")

    body_rows = []
    for row in rows:
        label = esc(row[label_key])
        if link_prefix:
            label = f'<a href="{link_prefix.format(**row)}">{label}</a>'
        cells = [f"<td>{label}</td>", f"<td>{esc(row['games'])}</td>"]
        for stat_name, _ in STAT_COLUMNS:
            cells.append(f"<td>{fmt_total(row.get(f'{stat_name}_total'))}</td>")
            cells.append(f"<td>{fmt_avg(row.get(f'{stat_name}_avg'))}</td>")
        body_rows.append("<tr>" + "".join(cells) + "</tr>")

    return (
        '<div class="table-wrap"><table>'
        f"<thead><tr>{''.join(head_cells)}</tr></thead>"
        f"<tbody>{''.join(body_rows)}</tbody>"
        "</table></div>"
    )


def query_rows(conn: sqlite3.Connection, sql: str, params: Iterable[object] = ()) -> list[dict]:
    conn.row_factory = sqlite3.Row
    return [dict(row) for row in conn.execute(sql, tuple(params))]


def aggregate_exprs(alias: str) -> str:
    parts = []
    for stat_name, _ in STAT_COLUMNS:
        parts.append(f"SUM(COALESCE({alias}.{stat_name}, 0)) AS {stat_name}_total")
        parts.append(
            "ROUND(CAST(SUM(COALESCE({alias}.{stat_name}, 0)) AS REAL) / COUNT(*), 2) "
            "AS {stat_name}_avg".format(alias=alias, stat_name=stat_name)
        )
    return ",\n            ".join(parts)


def build_site(db_path: Path, out_dir: Path) -> None:
    ensure_dir(out_dir)
    ensure_dir(out_dir / "teams")
    ensure_dir(out_dir / "years")

    conn = sqlite3.connect(db_path)
    try:
        season_rows = query_rows(
            conn,
            "SELECT DISTINCT season FROM games ORDER BY season DESC",
        )
        team_rows = query_rows(
            conn,
            "SELECT DISTINCT name AS team FROM teams ORDER BY name",
        )

        season_count = len(season_rows)
        team_count = len(team_rows)
        player_game_count = query_rows(
            conn,
            "SELECT COUNT(*) AS n FROM player_appearances",
        )[0]["n"]

        team_links = "".join(
            f'<li><a href="teams/{slugify(row["team"])}/index.html">{esc(row["team"])}</a></li>'
            for row in team_rows
        )
        year_links = "".join(
            f'<li><a href="years/{row["season"]}.html">{row["season"]}</a></li>'
            for row in season_rows
        )

        home_body = f"""
        <section>
          <p>Static AFL stats pages generated from the SQLite database.</p>
          <ul class="summary">
            <li>Teams: {team_count}</li>
            <li>Seasons: {season_count}</li>
            <li>Player appearances: {player_game_count}</li>
          </ul>
        </section>
        <section class="columns">
          <div>
            <h2>Browse Teams</h2>
            <ul>{team_links}</ul>
          </div>
          <div>
            <h2>Browse Years</h2>
            <ul>{year_links}</ul>
          </div>
        </section>
        """
        (out_dir / "index.html").write_text(page_template("AFL Stats", home_body, ""), encoding="utf-8")

        teams_index_body = f"<ul>{team_links}</ul>"
        (out_dir / "teams" / "index.html").write_text(
            page_template("Teams", teams_index_body, "../"),
            encoding="utf-8",
        )

        years_index_body = f"<ul>{year_links}</ul>"
        (out_dir / "years" / "index.html").write_text(
            page_template("Years", years_index_body, "../"),
            encoding="utf-8",
        )

        team_summary_sql = f"""
            SELECT
                pad.team AS label,
                pad.season AS season,
                COUNT(DISTINCT pad.game_id) AS games,
                {aggregate_exprs('pad')}
            FROM player_appearance_details pad
            WHERE pad.team = ?
            GROUP BY pad.team, pad.season
            ORDER BY pad.season DESC
        """

        team_year_sql = f"""
            SELECT
                COALESCE(p.name, pad.player_name) AS label,
                COUNT(*) AS games,
                {aggregate_exprs('pad')}
            FROM player_appearance_details pad
            LEFT JOIN players p ON p.id = pad.player_id
            WHERE pad.team = ? AND pad.season = ?
            GROUP BY COALESCE(p.name, pad.player_name)
            ORDER BY disposals_total DESC, games DESC, label
        """

        year_summary_sql = f"""
            SELECT
                pad.team AS label,
                COUNT(DISTINCT pad.game_id) AS games,
                {aggregate_exprs('pad')}
            FROM player_appearance_details pad
            WHERE pad.season = ?
            GROUP BY pad.team
            ORDER BY pad.team
        """

        for team_row in team_rows:
            team = team_row["team"]
            team_slug = slugify(team)
            team_dir = out_dir / "teams" / team_slug
            ensure_dir(team_dir)

            summary_rows = query_rows(conn, team_summary_sql, (team,))
            for row in summary_rows:
                row["label"] = str(row["season"])
                row["team_slug"] = team_slug
                row["year_file"] = f"{row['season']}.html"

            summary_body = (
                f"<p>{esc(team)} seasonal totals and per-game averages.</p>"
                + stats_table(summary_rows, "label", "Season", "{year_file}")
            )
            (team_dir / "index.html").write_text(
                page_template(f"{team} Stats", summary_body, "../../"),
                encoding="utf-8",
            )

            for row in summary_rows:
                season = row["season"]
                player_rows = query_rows(conn, team_year_sql, (team, season))
                player_body = (
                    f"<p>{esc(team)} player totals and per-game averages for {season}.</p>"
                    + stats_table(player_rows, "label", "Player")
                )
                (team_dir / f"{season}.html").write_text(
                    page_template(f"{team} {season} Player Stats", player_body, "../../"),
                    encoding="utf-8",
                )

        for season_row in season_rows:
            season = season_row["season"]
            season_rows_data = query_rows(conn, year_summary_sql, (season,))
            for row in season_rows_data:
                row["team_slug"] = slugify(row["label"])
                row["year_file"] = f"../teams/{row['team_slug']}/{season}.html"
            body = (
                f"<p>Team totals and per-game averages for the {season} season.</p>"
                + stats_table(season_rows_data, "label", "Team", "{year_file}")
            )
            (out_dir / "years" / f"{season}.html").write_text(
                page_template(f"{season} Team Stats", body, "../"),
                encoding="utf-8",
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
