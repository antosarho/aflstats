# AFL Stats Site

Static raw HTML pages generated from the SQLite database in the parent folder.

The generated site includes:

- team pages by season
- season pages by team
- all-time player leaderboards
- player leaderboards for each season
- sortable tables, hover explanations for every column, row filtering, and per-table column selection

## Regenerate

```bash
python3 generate_site.py --db ../afltables_games.sqlite --out .
```
