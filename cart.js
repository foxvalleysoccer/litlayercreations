(() => {
 const key = 'litlayer-cart-v1';
 let cart;
 try { cart = JSON.parse(localStorage.getItem(key) || '[]'); } catch { cart = []; }
 if (!Array.isArray(cart)) cart = [];
 cart = cart.filter(i => i && typeof i.name === 'string' && Number.isFinite(i.price) && i.price > 0 && Number.isInteger(i.quantity) && i.quantity > 0 && i.quantity <= 99);

 let isOpen = false;

 const toggle = document.createElement('button');
 toggle.type = 'button';
 toggle.setAttribute('aria-controls', 'litlayer-cart-panel');
 toggle.setAttribute('aria-expanded', 'false');
 toggle.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:10000;background:#111827;color:#fff;border:2px solid #fff;border-radius:999px;padding:12px 16px;font-weight:700;box-shadow:0 4px 24px #0006;cursor:pointer';
 document.body.append(toggle);

 const panel = document.createElement('section');
 panel.id = 'litlayer-cart-panel';
 panel.setAttribute('aria-label', 'Shopping cart');
 panel.style.cssText = 'display:none;position:fixed;right:16px;bottom:74px;z-index:10000;background:#fff;color:#222;padding:16px;border:2px solid #333;border-radius:12px;width:330px;max-width:calc(100vw - 32px);box-sizing:border-box;max-height:min(65vh,calc(100vh - 96px));overflow:auto;box-shadow:0 4px 24px #0006';
 document.body.append(panel);

 const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

 function cartCount() {
  return cart.reduce((n, i) => n + i.quantity, 0);
 }

 function setOpen(open) {
  isOpen = open;
  panel.style.display = isOpen ? 'block' : 'none';
  toggle.setAttribute('aria-expanded', String(isOpen));
 }

 function renderToggle() {
  const count = cartCount();
  toggle.textContent = count ? `Cart (${count})` : 'Cart';
  toggle.setAttribute('aria-label', count ? `Open shopping cart with ${count} item${count === 1 ? '' : 's'}` : 'Open shopping cart');
 }

 function render() {
  panel.replaceChildren();

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px';

  const heading = document.createElement('h2');
  heading.textContent = 'Your cart';
  heading.style.cssText = 'margin:0;font-size:20px';
  header.append(heading);

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.setAttribute('aria-label', 'Close shopping cart');
  close.style.cssText = 'border:1px solid #999;background:#f3f4f6;color:#111;padding:6px 10px;border-radius:8px;cursor:pointer';
  close.addEventListener('click', () => setOpen(false));
  header.append(close);
  panel.append(header);

  if (!cart.length) {
   const empty = document.createElement('p');
   empty.textContent = 'Your cart is empty.';
   panel.append(empty);
  }

  cart.forEach((item, index) => {
   const row = document.createElement('div');
   row.style.marginBottom = '12px';

   const label = document.createElement('div');
   label.textContent = item.name + ' - ' + money(item.price);
   row.append(label);

   const qty = document.createElement('input');
   qty.type = 'number';
   qty.min = 1;
   qty.max = 99;
   qty.value = item.quantity;
   qty.style.width = '65px';
   qty.setAttribute('aria-label', 'Quantity for ' + item.name);
   qty.addEventListener('input', () => {
    item.quantity = Math.max(1, Math.min(99, Math.floor(Number(qty.value) || 1)));
    save();
   });
   row.append(qty);

   const remove = document.createElement('button');
   remove.type = 'button';
   remove.textContent = 'Remove';
   remove.onclick = () => {
    cart.splice(index, 1);
    save();
   };
   row.append(remove);
   panel.append(row);
  });

  const count = cartCount();
  const subtotal = cart.reduce((n, i) => n + i.price * i.quantity, 0);
  const shipping = count === 0 || count >= 4 ? 0 : 10;
  const discount = Math.max(0, count - 4) * 5;

  const total = document.createElement('p');
  total.textContent = count + ' lights - Items ' + money(subtotal) + ' - Discount ' + money(discount) + ' - Shipping ' + money(shipping) + ' - Total ' + money(subtotal - discount + shipping);
  panel.append(total);

  const offer = document.createElement('p');
  offer.textContent = 'Free shipping with 4+ lights. Fifth light and each additional light: $5 off.';
  panel.append(offer);

  const form = document.createElement('form');
  form.action = 'https://www.paypal.com/cgi-bin/webscr';
  form.method = 'post';
  form.target = '_blank';
  const fields = { cmd: '_cart', upload: '1', business: 'foxvalleysoccer@gmail.com', currency_code: 'USD', handling_cart: shipping.toFixed(2), discount_amount_cart: discount.toFixed(2) };
  cart.forEach((item, index) => {
   const n = index + 1;
   fields['item_name_' + n] = item.name;
   fields['amount_' + n] = item.price.toFixed(2);
   fields['quantity_' + n] = item.quantity;
  });
  Object.entries(fields).forEach(([name, value]) => {
   const input = document.createElement('input');
   input.type = 'hidden';
   input.name = name;
   input.value = value;
   form.append(input);
  });
  const checkout = document.createElement('button');
  checkout.type = 'submit';
  checkout.textContent = 'Continue to PayPal';
  checkout.disabled = !count;
  form.append(checkout);
  form.addEventListener('submit', () => {
   if (typeof gtag === 'function') gtag('event', 'begin_checkout', { currency: 'USD', value: subtotal - discount + shipping, shipping, discount, items: cart.map(i => ({ item_name: i.name, price: i.price, quantity: i.quantity })), transport_type: 'beacon' });
  });
  panel.append(form);

  const note = document.createElement('small');
  note.textContent = 'Secure checkout with PayPal. Review your order before paying.';
  panel.append(note);

  renderToggle();
 }

 function save() {
  try { localStorage.setItem(key, JSON.stringify(cart)); } catch {}
  render();
 }

 toggle.addEventListener('click', () => setOpen(!isOpen));

 document.addEventListener('click', event => {
  const button = event.target.closest('[data-cart-item]');
  if (!button) return;
  const item = JSON.parse(button.dataset.cartItem);
  const existing = cart.find(i => i.name === item.name && i.price === item.price);
  if (existing) existing.quantity++;
  else cart.push({ ...item, quantity: 1 });
  save();
  setOpen(true);
 });

 document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && isOpen) setOpen(false);
 });

 render();
 setOpen(false);
})();
