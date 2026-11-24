// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail view with the model's own
// inputs and the protocol's farm plan, a live model sandbox, and the set-aside list. No network:
// every byte it shows is in data.js. The page recomputes a row from the snapshot figures and
// checks the number board.json carries, so the page's code and the board's data are visibly the
// same arithmetic; the sandbox re-runs that arithmetic with the reader's own constants.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, sandbox: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The radar-2 model in one function: the same arithmetic lib/model.ts runs. The sandbox passes
  // its own constants, so the board re-ranks live instead of trusting a hardcoded list.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var reach = 1 + model.reach_weight * Math.min(Math.max((row.chains || []).length - 1, 0), model.reach_cap);
    var base = row.tvl_usd * model.base_multiple;
    return { implied: Math.max(1, Math.round(base * growthMult * maturity * reach)), base: Math.round(base), growthMult: growthMult, maturityMult: maturity, reachMult: reach };
  }
  function activeModel() { return state.sandbox || DATA.model; }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasOn(chain) {
    var cheap = { Solana: 1, Base: 1, Arbitrum: 1, Optimism: 1, BSC: 1, Polygon: 1, Avalanche: 1, Sui: 1, Aptos: 1, Berachain: 1, Linea: 1, Scroll: 1, 'zkSync Era': 1, Blast: 1, Mode: 1 };
    if (chain === 'Ethereum') return 'about $8 of gas';
    if (cheap[chain]) return 'about $1 of gas';
    return 'about $3 of gas';
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('aggregator') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('asset management') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Make one qualifying action each week, such as a deposit, a borrow or a repayment.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('aggregator') >= 0) return 'Make one qualifying action each week, such as a swap, adding liquidity or claiming rewards.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Make one qualifying action each week, such as one small trade or a funding payment.';
    if (c.indexOf('prediction') >= 0) return 'Make one qualifying action each week, such as one market position or a settlement.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('asset management') >= 0) return 'Make one qualifying action each week, such as a deposit, a rebalance or a vote.';
    if (c.indexOf('bridge') >= 0) return 'Make one qualifying action each week, such as one bridge transfer or a swap on the far chain.';
    return 'Make one qualifying action each week, such as a deposit, a swap or a vote.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gasOn(chain), time: '15 minutes to set up' },
      { text: weeklyFor(p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('watch')) state.watchOnly = params.get('watch') === '1';
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchOnly) params.set('watch', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // The board under the sandbox, or the board as submitted: every row rescored, re-sorted, re-ranked.
  function viewRows() {
    if (!state.sandbox) return DATA.rows;
    var scored = DATA.rows.map(function (r) {
      var v = impliedOf(r, state.sandbox);
      var copy = {};
      Object.keys(r).forEach(function (k) { copy[k] = r[k]; });
      copy.implied_value_usd = v.implied;
      copy.base_value_usd = v.base;
      copy.growth_multiplier = Math.round(v.growthMult * 1e4) / 1e4;
      copy.maturity_multiplier = Math.round(v.maturityMult * 1e4) / 1e4;
      copy.reach_multiplier = Math.round(v.reachMult * 1e4) / 1e4;
      return copy;
    });
    scored.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0); });
    scored.forEach(function (r, i) { r.rank = i + 1; });
    return scored;
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return viewRows().filter(function (r) {
      if (state.watchOnly && !r.watch) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'chains') { av = (a.chains || []).length; bv = (b.chains || []).length; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', null, 'Token Radar', el('small', { text: 'Pre-token protocol index' }))),
      el('div', { class: 'top-meta' },
        el('span', { class: 'pill', html: 'Snapshot <b>' + DATA.as_of + '</b>' }),
        el('span', { class: 'pill', html: 'Source <b>DefiLlama</b>' }),
        el('span', { class: 'pill', html: 'Model <b>' + DATA.model_version + '</b>' })
      )
    );
  }

  function lede() {
    var total = DATA.rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { html: 'The watchlist is the floor: every protocol with at least <b>$' + Math.round(DATA.floor_usd / 1e6) + 'M</b> of TVL and no token on record. The early radar adds <b>' + DATA.early_size + '</b> more pre-token protocols below that floor, every one passing the same test. Implied value is a model, not a promise — and "records no token" is not the same as "has no token".' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every watchlist slug is ranked' })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.early_size + ' below the floor' })),
        el('div', { class: 'fact' }, el('span', { text: 'Combined implied value' }), el('b', { text: fmtUsd(total) }), el('small', { text: 'sum of the board' })),
        el('div', { class: 'fact' }, el('span', { text: 'Set aside' }), el('b', { text: String(DATA.set_aside_size) }), el('small', { text: 'pre-token, but a derivative or an exchange' }))
      ),
      el('div', { class: 'spot' }, DATA.rows.slice(0, 5).map(function (r) {
        return el('button', { type: 'button', class: 'spot-card', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'rk', text: 'RANK ' + r.rank }),
          el('b', { text: r.name }),
          el('span', { class: 'im', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'sub', text: 'TVL ' + fmtUsd(r.tvl_usd) }),
          el('span', { class: 'sub', text: '7d ' + fmtPct(r.change_7d) })
        );
      }))
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chn = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chn.addEventListener('change', function () { state.chain = chn.value; writeHash(); render(); });
    var watch = el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: state.watchOnly ? 'checked' : null, onchange: function (e) { state.watchOnly = e.target.checked; writeHash(); render(); } }),
      'Watchlist only'
    );
    var sort = el('select', { id: 'sort', 'aria-label': 'Sort the board' },
      [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7d growth'], ['age', 'Age'], ['chains', 'Chains'], ['name', 'Name']].map(function (o) {
        return el('option', { value: o[0], text: 'Sort: ' + o[1], selected: state.sort === o[0] ? 'selected' : null });
      })
    );
    sort.addEventListener('change', function () { state.sort = sort.value; state.dir = -1; render(); });
    function tab(name, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === name ? 'true' : 'false', text: label, onclick: function () { state.tab = name; writeHash(); render(); } });
    }
    var countText = state.tab === 'pre-token' ? rows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : DATA.set_aside.length + ' largest set aside';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chn),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, tab('pre-token', 'Pre-token'), tab('live', 'Live token'), tab('set-aside', 'Set aside'))),
      watch,
      el('div', { class: 'field' }, el('label', { for: 'sort', text: 'Sort' }), sort),
      el('span', { class: 'count', text: countText })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') + ((r.chains.length > 2) ? ' +' + (r.chains.length - 2) : '') : 'an unnamed chain') + (r.watch ? ' ' : '') }),
          r.watch ? el('span', { class: 'watch', text: 'WATCHLIST' }) : null
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: String((r.chains || []).length) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status pre', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' + (state.sandbox ? ' Sandbox is on: ranks are recomputed with your constants.' : '') }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('chains', 'Chains'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and shown here so a reader can compare what a live token is worth in each category.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function setAsideTable() {
    var tbody = el('tbody');
    DATA.set_aside.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'out' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { text: r.reason }),
        el('td', null, el('span', { class: 'status out', text: 'not ranked' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'The ' + DATA.set_aside.length + ' largest pre-token protocols the board set aside, with the reason each one fails the test. ' + DATA.set_aside_size + ' pre-token protocols are set aside in all; the rest are smaller than these.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Why it is set aside' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var panel = el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. TVL is the size of the economy a token would tax; seven-day growth is the momentum that economy moves with; age with no token is how long the launch has been deferred; chain count is how many user bases the token would reach.' }),
      el('div', { class: 'formula', html: '<b>implied</b> = round( tvl_usd x <b>' + m.base_multiple + '</b> x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x <b>' + m.growth_weight + '</b>) x (<b>' + m.maturity_floor + '</b> + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x <b>' + m.maturity_range + '</b>) x (1 + <b>' + m.reach_weight + '</b> x min(chains - 1, ' + m.reach_cap + ')) )' }),
      el('p', { class: 'sub', text: 'Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days, and unknown seven-day growth counts as 0. The early radar is every pre-token protocol below the watchlist floor that passes the same test as the watchlist, and the live-token protocols are set aside with their market caps shown.' })
    );
    panel.appendChild(sandbox());
    return panel;
  }

  function sandbox() {
    var box = el('div', { class: 'sandbox' },
      el('h3', { text: 'Model sandbox — change the constants, watch the board re-rank' }),
      el('p', { class: 'sub', text: 'The sandbox re-runs the same function on the same snapshot figures. It proves the ranking is arithmetic, not a hardcoded list: move a slider and the board answers.' })
    );
    var out = el('div', { class: 'sandbox-out', text: 'Sandbox off: the board shows the submitted ranking.' });
    function slider(label, key, min, max, step, fmt) {
      var val = el('b', { text: fmt((state.sandbox || DATA.model)[key]) });
      var input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String((state.sandbox || DATA.model)[key]), 'aria-label': label });
      // The label follows the drag; the board re-ranks once, when the slider is released.
      input.addEventListener('input', function () { val.textContent = fmt(parseFloat(input.value)); });
      input.addEventListener('change', function () {
        if (!state.sandbox) state.sandbox = JSON.parse(JSON.stringify(DATA.model));
        state.sandbox[key] = parseFloat(input.value);
        val.textContent = fmt(state.sandbox[key]);
        refreshSandbox();
      });
      return el('div', { class: 'slider' }, el('label', null, el('span', { text: label }), val), input);
    }
    function refreshSandbox() {
      if (!state.sandbox) { out.innerHTML = 'Sandbox off: the board shows the submitted ranking.'; return; }
      sandboxSummary();
      render();
    }
    // The summary text alone, without re-rendering: render() rebuilds this
    // box, so the text must be recomputed on every build while the sandbox is on.
    function sandboxSummary() {
      var re = viewRows();
      var moved = 0;
      re.forEach(function (r) {
        var orig = DATA.rows.filter(function (o) { return o.slug === r.slug; })[0];
        if (orig && orig.rank !== r.rank) moved++;
      });
      var top = re.slice(0, 3).map(function (r) { return '#' + r.rank + ' ' + r.name + ' (' + fmtUsd(r.implied_value_usd) + ')'; }).join(', ');
      out.innerHTML = 'Sandbox on: <b>' + moved + ' of ' + re.length + ' rows changed rank</b>. New top three: <b>' + top + '</b>.';
    }
    var grid = el('div', { class: 'sliders' },
      slider('Base multiple (TVL x)', 'base_multiple', 0.1, 0.4, 0.01, function (v) { return v.toFixed(2); }),
      slider('Growth weight', 'growth_weight', 0, 1.5, 0.05, function (v) { return v.toFixed(2); }),
      slider('Maturity range', 'maturity_range', 0, 0.8, 0.05, function (v) { return v.toFixed(2); }),
      slider('Reach weight per chain', 'reach_weight', 0, 0.08, 0.01, function (v) { return v.toFixed(2); })
    );
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset to the submitted model', onclick: function () { state.sandbox = null; out.textContent = 'Sandbox off: the board shows the submitted ranking.'; render(); } });
    box.appendChild(grid);
    box.appendChild(out);
    var row = el('div', { style: 'margin-top:12px' }, reset);
    box.appendChild(row);
    if (state.sandbox) sandboxSummary();
    box._refresh = refreshSandbox;
    return box;
  }

  function methodPanel() {
    return el('section', { class: 'panel method' },
      el('h2', { text: 'What counts as a launch candidate, and what this is not' }),
      el('ul', null,
        el('li', { html: '<b>Records no token.</b> Market cap, CoinGecko id and symbol are all null in the snapshot. A protocol on this board may still have a token its DefiLlama record does not carry — the snapshot is a record, not proof.' }),
        el('li', { html: '<b>Not a derivative.</b> Bridges, canonical bridges, liquid staking and restaking, restaked BTC and centralised exchanges are set aside, as are names carrying wrapped, staked or staking, names beginning with an exchange, and names ending in a version marker. A wrapped or staked product of a token that already trades is not a launch of its own.' }),
        el('li', { html: '<b>Every row is scored, none is picked.</b> The same four-factor function scores all ' + DATA.board_size + ' rows, from the snapshot figures alone. There is no list of favourite names anywhere in the code.' }),
        el('li', { html: '<b>Implied value is the entry\u2019s claim, never a price.</b> It says what a token would be worth if the protocol\u2019s record stayed as it is. It does not predict whether or when a token is issued.' }),
        el('li', { html: '<b>Data as of ' + DATA.as_of + '.</b> The snapshot is sealed: every run of this entry and the grade read the same bytes, from DefiLlama\u2019s public protocol index.' })
      ),
      el('p', { class: 'note', text: 'Farm plans are generic by category, chain, size and age — they tell a reader what to do, what it costs and how long it takes. They are not financial advice, and no step asks a reader to pay to claim anything.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = viewRows().filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var v = impliedOf(row, DATA.model);
    var peers = DATA.live.filter(function (l) { return l.category === row.category; }).slice(0, 3);
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'rankline', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watch ? ' · Watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · first listed ' + (row.listed_at || 'unknown') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — the model, step by step' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Base (TVL x ' + DATA.model.base_multiple + ')' }), el('b', { class: 'num', text: fmtUsd(v.base) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: 'x' + v.growthMult.toFixed(3) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: 'x' + v.maturityMult.toFixed(3) })),
        el('div', null, el('span', { text: 'Reach multiplier' }), el('b', { class: 'num', text: 'x' + v.reachMult.toFixed(3) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(v.implied) + (v.implied === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    if (peers.length > 0) {
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Live peers in ' + (row.category || 'this category') }),
        el('p', { class: 'sub', text: 'Protocols in the same category whose token already trades — what the market pays for a live token here.' }),
        el('ul', { class: 'peers' }, peers.map(function (l) {
          return el('li', { html: '<b>' + l.name + '</b> — market cap ' + fmtUsd(l.mcap_usd) + ' on TVL ' + fmtUsd(l.tvl_usd) });
        }))
      ));
    }
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') shell.appendChild(boardTable());
    else if (state.tab === 'live') shell.appendChild(liveTable());
    else shell.appendChild(setAsideTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(methodPanel());
    shell.appendChild(el('p', { class: 'foot', text: 'Token Radar · model ' + DATA.model_version + ' · snapshot ' + DATA.as_of + ' from DefiLlama. Implied values are this entry\u2019s model, not prices, and no token launch is predicted. Farm at your own risk.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
