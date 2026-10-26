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
document.addEventListener("DOMContentLoaded", function () {

    const gallery = document.querySelector(".gallery-strip");

    const images = document.querySelectorAll(".gallery-track .tile");

    images.forEach((image) => {

        image.addEventListener("click", function () {

            if (window.innerWidth <= 768) {

                image.scrollIntoView({
                    behavior: "smooth",
                    block: "nearest",
                    inline: "center"
                });

            }

        });

    });

});