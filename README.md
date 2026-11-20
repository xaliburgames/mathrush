# Math Rush — site web + serveur du duel en ligne

Un seul Worker Cloudflare (`math-rush`) fait deux choses :
- sert le **site** (`index.html`, `confidentialite.html`, `jouer/`, `img/`) ;
- héberge le **duel en ligne** (`worker/index.js`, Durable Object `Salle`) sur `wss://…/ws`.

Fichiers :
- `index.html` : page d'accueil FR/EN (bouton de langue)
- `confidentialite.html` : politique de confidentialité (exigée par Google Play / App Store)
- `jouer/` : page « bientôt » ; devient le jeu quand `MATH RUSH\html5-export\` existe (voir plus bas)
- `wrangler.jsonc` : Worker + actifs statiques (`run_worker_first` pour `/ws`)

## Publier
Lancer `publier-math-rush.bat` (dossier GAMEMAKER, à côté de `publier-chess-rush.bat`) : GitHub puis Cloudflare. Pour une mise à jour, relancer.

## Mettre le jeu jouable dans le navigateur
1. Dans `scr_core.gml`, mettre `#macro DEBUG_CHEAT false`.
2. GameMaker : Build > Create Executable, cible HTML5 (version « Zip » ou dossier).
3. Mettre le contenu (index.html + html5game/…) dans `MATH RUSH\html5-export\`.
4. Relancer `publier-math-rush.bat` : le dossier est copié dans `jouer/` (refusé si DEBUG_CHEAT est encore à true).

`NET_URL` dans `scr_ui.gml` doit rester `wss://math-rush.francrouge.workers.dev/ws` (ou l'adresse du domaine choisi).
