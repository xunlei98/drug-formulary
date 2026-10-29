import { h, icon, clear, fmt } from '../dom.js';
import { state, pendingFor, syncNow, dismissRejected, syncStatus, negatives, loadReviews, markReviewed } from '../store.js';
import { stat, locName, toast, LABEL } from '../ui.js';

function describe(o) {
  if (o.kind === 'movement') {
    const m = o.movement;
    return `${LABEL[m.type]} ${m.qty} × ${state.drugMap.get(m.drug)?.perihal || m.drug}${m.from ? ` from ${locName(m.from)}` : ''}${m.to ? ` to ${locName(m.to)}` : ''}`;
  }
  return `Patient Kategori change${o.patch?.kategori ? ` to ${o.patch.kategori}` : ''}`;
}

export function syncView() {
  const body = h('div', { class: 'stack' });
  const paint = () => {
    const st = syncStatus();
    const mine = pendingFor();
    const other = state.outbox.length - mine.length;
    const rejected = state.rejected.filter((r) => r.uid === state.user.uid);
    clear(body,
      stat('Waiting to sync', mine.length, h('small', null, state.online ? '' : ' · offline')),
      h('div', { class: 'row wrap' },
        h('span', { class: `badge ${st.kind}` }, st.label),
        h('span', { class: 'sub' }, state.syncedAt ? `Last download ${fmt.dateTime(state.syncedAt)}` : 'Not downloaded yet'),
        h('button', { class: 'btn', type: 'button', disabled: !state.online || state.syncing, onClick: () => syncNow() }, icon('sync'), 'Sync now')),
      other > 0 && h('div', { class: 'notice warn' }, `${other} item(s) from another user are waiting on this device. They sync when that user signs in.`),
      h('section', { class: 'card' }, h('p', { class: 'label card-pad' }, 'Pending'),
        h('ul', { class: 'list' }, mine.length ? mine.map((o) => h('li', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name' }, describe(o)), h('div', { class: 'meta' }, fmt.dateTime(o.created))), h('span', { class: 'pill s-near' }, 'Pending'))) : h('li', { class: 'empty' }, 'Everything is synced.'))),
      rejected.length > 0 && h('section', { class: 'card' }, h('p', { class: 'label card-pad' }, 'Needs attention'),
        h('ul', { class: 'list' }, rejected.map((o) => h('li', { class: 'item' },
          h('div', { class: 'grow' }, h('div', { class: 'name' }, describe(o)), h('div', { class: 'meta' }, `The server refused it: ${o.reason}`)),
          h('button', { class: 'btn ghost', type: 'button', onClick: () => dismissRejected(o.id) }, 'Dismiss'))))));
  };
  paint();
  return { el: body, title: 'Sync', update: paint };
}

// Negative balances are computed on this device from the ledger. A review records that someone checked one;
// it reappears if the balance changes again.
export function review() {
  const body = h('div', { class: 'stack' });
  let reviews = new Map();
  const paint = () => {
    const items = negatives().filter((n) => reviews.get(n.key)?.qty !== n.qty);
    clear(body, stat('Stock to review', items.length),
      h('p', { class: 'sub' }, 'These balances are below zero, usually because an offline entry synced late. Recount, then mark each as reviewed. Nothing is changed automatically.'),
      h('section', { class: 'card' }, h('ul', { class: 'list' }, items.length ? items.map((i) => h('li', { class: 'item' },
        h('div', { class: 'grow' }, h('div', { class: 'name' }, state.drugMap.get(i.drug)?.perihal || i.drug), h('div', { class: 'meta' }, `${locName(i.location)}: balance ${fmt.n(i.qty)}`)),
        h('button', { class: 'btn ghost', type: 'button', onClick: async () => {
          const note = prompt('Note (optional)') ?? '';
          try { await markReviewed(i, note); reviews.set(i.key, { qty: i.qty }); toast('Marked reviewed'); paint(); } catch (e) { toast(e.message, true); }
        } }, 'Reviewed'))) : h('li', { class: 'empty' }, 'Nothing to review.'))));
  };
  loadReviews().then((r) => { reviews = r; paint(); }).catch(() => paint());
  paint();
  return { el: body, title: 'Stock review', update: paint };
}
