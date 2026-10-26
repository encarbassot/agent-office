/* El inventario: todos los muebles de todas las salas, gratis e infinitos.
 *
 * Lo que está en una sala también se puede poner en cualquier otra: el catálogo sale de los mismos
 * dibujantes de gfx.js (HH.FURNI / HH.DECO), no de una sala concreta.
 *
 *   floor   { type, label, w, d, …props }        muebles de suelo (props = lo que entiende su dibujante)
 *   wall    { kind, label, aw, zh, z0, …props }  cosas de pared; aw = ancho en baldosas, zh = alto en px
 */
(function () {
  const HH = (window.HH = window.HH || {});
  const F = (type, label, w = 1, d = 1, props = {}) => ({ type, label, w, d, ...props });
  const Wl = (kind, label, aw, zh, z0, props = {}) => ({ kind, label, aw, zh, z0, ...props });

  HH.CATALOG = {
    floor: [
      F('pingpong', 'Mesa de ping-pong', 2, 1),
      F('futbolin', 'Futbolín', 2, 1),
      F('billar', 'Billar', 2, 1),
      F('arcade', 'Máquina recreativa'),
      F('bigtable', 'Mesa de reuniones', 3, 2),
      F('bossdesk', 'Mesa de despacho', 2, 1),
      F('workdesk', 'Mesa de trabajo (con pantalla)'),
      F('rug', 'Felpudo (llama a la gente)', 1, 1, { floor: true, style: 'mat', action: 'call' }),
      F('table', 'Mesita de café'),
      F('sofa', 'Sofá', 2, 1),
      F('armchair', 'Butaca'),
      F('chair', 'Silla de oficina'),
      F('dirchair', 'Silla de director'),
      F('desk', 'Mesa de planos', 2, 1),
      F('side', 'Mesita con taza', 1, 1, { item: 'cup' }),
      F('side', 'Mesita con portátil', 1, 1, { item: 'laptop' }),
      F('side', 'Mesita con teléfono', 1, 1, { item: 'phone' }),
      F('side', 'Mesita con tablet', 1, 1, { item: 'tablet' }),
      F('side', 'Máquina de escribir', 1, 1, { item: 'typewriter', color: '#c08a5e' }),
      F('plant', 'Planta'),
      F('plant', 'Planta seca', 1, 1, { dry: true }),
      F('lamp', 'Lámpara de pie'),
      F('bookshelf', 'Estantería'),
      F('filing', 'Archivador'),
      F('ledger', 'Caja registradora'),
      F('trophies', 'Vitrina de trofeos'),
      F('easel', 'Caballete'),
      F('tubes', 'Planos enrollados'),
      F('bricks', 'Palé de ladrillos'),
      F('rack', 'Rack de servidores'),
      F('aircon_floor', 'Climatizador'),
      F('camera', 'Cámara'),
      F('ringlight', 'Aro de luz'),
      F('spot', 'Foco de plató'),
      F('safe', 'Caja fuerte'),
      F('lockers', 'Taquillas'),
      F('pedestal', 'Huevo de oro'),
      F('hay', 'Bala de paja'),
      F('nest', 'Nido'),
      F('nest', 'Nido de oro', 1, 1, { gold: true }),
      F('fence', 'Valla', 3, 1),
      F('hen', 'Gallina', 1, 1, { noBlock: true }),
      F('rug', 'Alfombra corazón', 3, 2, { floor: true }),
      F('rug', 'Alfombra naranja', 3, 2, { floor: true, style: 'plain', color: '#e8590c', color2: '#ffa94d' }),
      F('rug', 'Alfombra granate', 3, 2, { floor: true, style: 'plain', color: '#a61e4d', color2: '#e64980' }),
      F('rug', 'Marcas de plató', 2, 2, { floor: true, style: 'tape' }),
      F('rug', 'Cables por el suelo', 3, 1, { floor: true, style: 'cables' }),
    ],
    wall: [
      Wl('neon', 'Neón AGENT OFFICE', HH.neonWidth ? HH.neonWidth('AGENT OFFICE') : 7, 14, 56, { text: 'AGENT OFFICE', split: 6 }),
      Wl('frame', 'Cuadro rojo', 0.7, 14, 30, { color: '#ff6b6b' }),
      Wl('frame', 'Cuadro azul', 0.7, 14, 30, { color: '#4dabf7' }),
      Wl('frame', 'Cuadro amarillo', 0.7, 14, 30, { color: '#ffd43b' }),
      Wl('clock', 'Reloj', 0, 0, 56),
      Wl('window', 'Ventana', 2, 26, 30),
      Wl('poster', 'Póster bento', 2, 24, 30),
      Wl('plans', 'Pizarra de planos', 3, 26, 30),
      Wl('chart', 'Gráfica', 2.6, 24, 32),
      Wl('calendar', 'Calendario', 1.2, 18, 36),
      Wl('words', 'Titulares', 3, 28, 32),
      Wl('funnel', 'Embudo de ventas', 3, 28, 30),
      Wl('postits', 'Pósits', 3, 28, 30),
      Wl('tvwall', 'Pantalla grande', 3.5, 28, 26),
      Wl('cctv', 'Cámaras de seguridad', 2, 18, 40),
      Wl('vault', 'Puerta de cámara', 2, 36, 12),
      Wl('registro', 'Registro público/privado', 2.2, 24, 34),
      Wl('aircon', 'Aire acondicionado', 2, 10, 50),
      Wl('shelf', 'Balda con tarros', 1.4, 0, 40),
      Wl('chroma', 'Croma', 5, 62, 0),
    ],
  };

  // a fresh wall item from its catalog entry, sitting at «a» on «wall»
  HH.makeDeco = function (item, wall, a) {
    const { kind, aw, zh, z0, label, ...props } = item;
    if (kind === 'clock') return { kind, wall, a0: a, z0 };
    if (kind === 'shelf') return { kind, wall, a0: a, a1: a + aw, z0, ...props };
    if (kind === 'chroma') return { kind, wall, a0: a, a1: a + aw, z0: 0, z1: zh, ...props };
    return { kind, wall, a0: a, a1: a + aw, z0, z1: z0 + zh, ...props };
  };
  HH.makeFurni = function (item, x, y) {
    const { label, ...f } = item;
    return { ...f, x, y };
  };
})();
