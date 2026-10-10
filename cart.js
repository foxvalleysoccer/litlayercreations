(() => {
 const key='litlayer-cart-v1';
 let cart; try {cart=JSON.parse(localStorage.getItem(key)||'[]');} catch {cart=[];}
 if(!Array.isArray(cart))cart=[];
 cart=cart.filter(i=>i&&typeof i.name==='string'&&Number.isFinite(i.price)&&i.price>0&&Number.isInteger(i.quantity)&&i.quantity>0&&i.quantity<=99);
 const panel=document.createElement('section');
 panel.style.cssText='position:fixed;right:16px;bottom:16px;z-index:10000;background:#fff;color:#222;padding:16px;border:2px solid #333;border-radius:12px;width:330px;max-width:calc(100vw - 32px);box-sizing:border-box;max-height:65vh;overflow:auto;box-shadow:0 4px 24px #0006';
 document.body.append(panel);
 const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
 function render(){
  panel.replaceChildren();
  const heading=document.createElement('h2');heading.textContent='Your cart';panel.append(heading);
  cart.forEach((item,index)=>{
   const row=document.createElement('div'); row.style.marginBottom='12px';
   const label=document.createElement('div');label.textContent=item.name+' — '+money(item.price);row.append(label);
   const qty=document.createElement('input');qty.type='number';qty.min=1;qty.max=99;qty.value=item.quantity;qty.style.width='65px';qty.setAttribute('aria-label','Quantity for '+item.name);
   qty.addEventListener('input',()=>{item.quantity=Math.max(1,Math.min(99,Math.floor(Number(qty.value)||1)));save();});row.append(qty);
   const remove=document.createElement('button');remove.textContent='Remove';remove.onclick=()=>{cart.splice(index,1);save();};row.append(remove);panel.append(row);
  });
  const count=cart.reduce((n,i)=>n+i.quantity,0),subtotal=cart.reduce((n,i)=>n+i.price*i.quantity,0),shipping=count===0||count>=4?0:10;
  const discount=Math.max(0,count-4)*5;
  const total=document.createElement('p');total.textContent=count+' lights · Items '+money(subtotal)+' · Discount '+money(discount)+' · Shipping '+money(shipping)+' · Total '+money(subtotal-discount+shipping);panel.append(total);
  const offer=document.createElement('p');offer.textContent='Free shipping with 4+ lights. Fifth light and each additional light: $5 off.';panel.append(offer);
  const form=document.createElement('form');form.action='https://www.paypal.com/cgi-bin/webscr';form.method='post';form.target='_blank';
  const fields={cmd:'_cart',upload:'1',business:'foxvalleysoccer@gmail.com',currency_code:'USD',handling_cart:shipping.toFixed(2),discount_amount_cart:discount.toFixed(2)};
  cart.forEach((item,index)=>{const n=index+1;fields['item_name_'+n]=item.name;fields['amount_'+n]=item.price.toFixed(2);fields['quantity_'+n]=item.quantity;});
  Object.entries(fields).forEach(([name,value])=>{const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);});
  const checkout=document.createElement('button');checkout.type='submit';checkout.textContent='Continue to PayPal';checkout.disabled=!count;form.append(checkout);form.addEventListener('submit',()=>{if(typeof gtag==='function')gtag('event','begin_checkout',{currency:'USD',value:subtotal-discount+shipping,shipping,discount,items:cart.map(i=>({item_name:i.name,price:i.price,quantity:i.quantity})),transport_type:'beacon'});});panel.append(form);
  const note=document.createElement('small');note.textContent='Secure checkout with PayPal. Review your order before paying.';panel.append(note);
 }
 function save(){try{localStorage.setItem(key,JSON.stringify(cart));}catch{}render();}
 document.addEventListener('click',event=>{const button=event.target.closest('[data-cart-item]');if(!button)return;const item=JSON.parse(button.dataset.cartItem);const existing=cart.find(i=>i.name===item.name&&i.price===item.price);if(existing)existing.quantity++;else cart.push({...item,quantity:1});save();});
 render();
})();
