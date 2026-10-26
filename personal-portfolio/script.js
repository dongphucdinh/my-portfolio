const menu=document.getElementById('menu');
const nav=document.getElementById('nav');
menu.addEventListener('click',()=>{
    const open=nav.classList.toggle('show');
    menu.setAttribute('aria-expanded',String(open));
    menu.textContent=open?'✕':'☰';
});
nav.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>{
    nav.classList.remove('show');
    menu.setAttribute('aria-expanded','false');
    menu.textContent='☰';
}));
