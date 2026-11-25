import { applyDom, pageLang, translate } from './i18n.js';

applyDom(document);
if (pageLang() !== 'en') {
  const title = translate('guide.title');
  if (title) document.title = title;
  const kicker = translate('cite.kicker');
  if (kicker) globalThis.__teamsterCiteKicker = kicker;
}
