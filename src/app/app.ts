import {
  Component,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  HostBinding,
  ChangeDetectorRef,
  inject,
} from '@angular/core';

import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { Header } from './components/header/header';
import { Importe } from './components/importe/importe';

import Chart from 'chart.js/auto';
import type { BarElement, ScriptableContext } from 'chart.js';

const FUENTE = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const COLOR_INGRESO = '0, 214, 163';
const COLOR_GASTO = '255, 82, 119';

// =====================================
// INTERFACES
// =====================================

interface Movimiento {
  id: number;
  concepto: string;
  cantidad: number;
  tipo: 'ingreso' | 'gasto';
}

interface Tarea {
  id: number;
  nombre: string;
  completada: boolean;
}

type TipoMovimiento = 'ingreso' | 'gasto';
type Filtro = 'todos' | TipoMovimiento;
type Orden = 'recientes' | 'mayor' | 'menor';
type ModoToast = 'registro' | 'eliminado';
type CampoEditable = 'concepto' | 'cantidad';
type EstadoPresupuesto = 'ok' | 'alerta' | 'excedido';

interface MovimientoEliminado {
  movimiento: Movimiento;
  indice: number;
}

// =====================================
// COMPONENTE PRINCIPAL
// =====================================

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Header, FormsModule, Importe, DecimalPipe],
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App implements AfterViewInit, OnDestroy {
  private cdr = inject(ChangeDetectorRef);

  // =====================================
  // REFERENCIAS A LAS GRÁFICAS
  // =====================================

  @ViewChild('graficaBalance')
  graficaBalance!: ElementRef<HTMLCanvasElement>;

  @ViewChild('graficaDistribucion')
  graficaDistribucion!: ElementRef<HTMLCanvasElement>;

  private chartBalance?: Chart<'bar', number[], string>;

  private chartDistribucion?: Chart<'doughnut', number[], string>;

  private vistasPreparadas = false;

  // =====================================
  // TEMPORIZADORES
  // =====================================

  private temporizadorNotificacion?: ReturnType<typeof setTimeout>;

  private temporizadorSalidaToast?: ReturnType<typeof setTimeout>;

  private temporizadorAnimacion?: ReturnType<typeof setTimeout>;

  private temporizadorInsercion?: ReturnType<typeof setTimeout>;

  // =====================================
  // MODO OSCURO
  // =====================================

  @HostBinding('class.modo-oscuro')
  modoOscuro = false;

  alternarTema(): void {
    this.modoOscuro = !this.modoOscuro;

    if (this.vistasPreparadas) {
      this.crearGraficas();
    }
  }

  // =====================================
  // FORMULARIO DE MOVIMIENTOS
  // =====================================

  nuevoConcepto = '';

  nuevaCantidad = 0;

  nuevoTipo: TipoMovimiento = 'gasto';

  // =====================================
  // FILTROS
  // =====================================

  filtroActual: Filtro = 'todos';

  cambiarFiltro(filtro: Filtro): void {
    this.filtroActual = filtro;
    this.actualizarGraficas();
  }

  // =====================================
  // BÚSQUEDA Y ORDENACIÓN DEL HISTORIAL
  // =====================================

  busqueda = '';

  orden: Orden = 'recientes';

  private readonly ordenes: Orden[] = ['recientes', 'mayor', 'menor'];

  private readonly etiquetasOrden: Record<Orden, string> = {
    recientes: 'Más recientes',
    mayor: 'Mayor importe',
    menor: 'Menor importe',
  };

  get etiquetaOrden(): string {
    return this.etiquetasOrden[this.orden];
  }

  cambiarOrden(): void {
    const siguiente = (this.ordenes.indexOf(this.orden) + 1) % this.ordenes.length;
    this.orden = this.ordenes[siguiente];
  }

  limpiarBusqueda(): void {
    this.busqueda = '';
  }

  private normalizar(texto: string): string {
    return texto
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  // =====================================
  // PRESUPUESTO MENSUAL
  // =====================================

  limiteMensual: number | null = 1000;

  get limiteValido(): number {
    const limite = Number(this.limiteMensual);
    return Number.isFinite(limite) && limite > 0 ? limite : 0;
  }

  get porcentajePresupuesto(): number {
    return this.limiteValido > 0 ? (this.totalGastos / this.limiteValido) * 100 : 0;
  }

  get anchoBarraPresupuesto(): number {
    return Math.min(100, this.porcentajePresupuesto);
  }

  get restantePresupuesto(): number {
    return this.limiteValido - this.totalGastos;
  }

  get estadoPresupuesto(): EstadoPresupuesto {
    if (this.porcentajePresupuesto > 100) {
      return 'excedido';
    }

    return this.porcentajePresupuesto >= 75 ? 'alerta' : 'ok';
  }

  // =====================================
  // MOVIMIENTOS INICIALES
  // =====================================

  movimientos: Movimiento[] = [
    {
      id: 1,
      concepto: 'Nómina',
      cantidad: 1500,
      tipo: 'ingreso',
    },
    {
      id: 2,
      concepto: 'Supermercado',
      cantidad: 85,
      tipo: 'gasto',
    },
    {
      id: 3,
      concepto: 'Gasolina',
      cantidad: 50,
      tipo: 'gasto',
    },
  ];

  // =====================================
  // ANIMACIONES
  // =====================================

  animarBalance = false;

  animandoInsercion = false;

  ultimoMovimientoId: number | null = null;

  ultimoTipoMovimiento: TipoMovimiento | null = null;

  // =====================================
  // NOTIFICACIONES
  // =====================================

  mostrarNotificacion = false;

  ocultandoNotificacion = false;

  notificacionTipo: TipoMovimiento = 'ingreso';

  notificacionConcepto = '';

  notificacionCantidad = 0;

  notificacionModo: ModoToast = 'registro';

  // Toast detenido mientras el ratón (o el foco) está sobre él
  toastPausado = false;

  private finToast = 0;

  private restanteToast = 0;

  // Último movimiento eliminado, disponible para deshacer mientras dure el toast
  private movimientoEliminado: MovimientoEliminado | null = null;

  // =====================================
  // MOVIMIENTOS FILTRADOS
  // =====================================

  get movimientosFiltrados(): Movimiento[] {
    if (this.filtroActual === 'todos') {
      return this.movimientos;
    }

    return this.movimientos.filter((movimiento) => movimiento.tipo === this.filtroActual);
  }

  // =====================================
  // MOVIMIENTOS VISIBLES EN EL HISTORIAL (filtro + búsqueda + orden)
  // =====================================

  get movimientosVisibles(): Movimiento[] {
    const texto = this.normalizar(this.busqueda);
    let lista = this.movimientosFiltrados;

    if (texto !== '') {
      lista = lista.filter((m) => this.normalizar(m.concepto).includes(texto));
    }

    if (this.orden === 'mayor') {
      return [...lista].sort((a, b) => b.cantidad - a.cantidad);
    }

    if (this.orden === 'menor') {
      return [...lista].sort((a, b) => a.cantidad - b.cantidad);
    }

    return lista;
  }

  // =====================================
  // TOTAL INGRESOS
  // =====================================

  get totalIngresos(): number {
    return this.movimientos
      .filter((m) => m.tipo === 'ingreso')
      .reduce((total, m) => total + m.cantidad, 0);
  }

  // =====================================
  // TOTAL GASTOS
  // =====================================

  get totalGastos(): number {
    return this.movimientos
      .filter((m) => m.tipo === 'gasto')
      .reduce((total, m) => total + m.cantidad, 0);
  }

  // =====================================
  // BALANCE
  // =====================================

  get balance(): number {
    return this.totalIngresos - this.totalGastos;
  }

  // =====================================
  // AÑADIR MOVIMIENTO
  // =====================================

  agregarMovimiento(): void {
    if (this.animandoInsercion) {
      return;
    }

    const concepto = this.nuevoConcepto.trim();
    const cantidad = Number(this.nuevaCantidad);

    if (
      concepto === '' ||
      !Number.isFinite(cantidad) ||
      cantidad <= 0 ||
      (this.nuevoTipo !== 'ingreso' && this.nuevoTipo !== 'gasto')
    ) {
      return;
    }

    const nuevoMovimiento: Movimiento = {
      id: Math.max(0, ...this.movimientos.map((m) => m.id)) + 1,
      concepto,
      cantidad,
      tipo: this.nuevoTipo,
    };

    // Insertar el movimiento al principio
    this.movimientos = [nuevoMovimiento, ...this.movimientos];

    // Animaciones de entrada
    this.iniciarAnimacionInsercion(nuevoMovimiento);

    // Mostrar notificación
    this.mostrarToast(nuevoMovimiento);

    // Limpiar formulario
    this.nuevoConcepto = '';
    this.nuevaCantidad = 0;
    this.nuevoTipo = 'gasto';

    // Actualizar gráficas
    this.actualizarGraficas();
  }

  // =====================================
  // ANIMACIÓN DE INSERCIÓN
  // =====================================

  private iniciarAnimacionInsercion(movimiento: Movimiento): void {
    // Guardar información para las animaciones
    this.ultimoMovimientoId = movimiento.id;
    this.ultimoTipoMovimiento = movimiento.tipo;

    // Activar animaciones
    this.animarBalance = true;
    this.animandoInsercion = true;

    // Reiniciar temporizador de animación
    if (this.temporizadorAnimacion) {
      clearTimeout(this.temporizadorAnimacion);
    }

    this.temporizadorAnimacion = setTimeout(() => {
      this.animarBalance = false;
      this.ultimoMovimientoId = null;
      this.ultimoTipoMovimiento = null;
      this.cdr.detectChanges();
    }, 1800);

    // Reiniciar temporizador de inserción
    if (this.temporizadorInsercion) {
      clearTimeout(this.temporizadorInsercion);
    }

    this.temporizadorInsercion = setTimeout(() => {
      this.animandoInsercion = false;
      this.cdr.detectChanges();
    }, 650);
  }

  // =====================================
  // ELIMINAR MOVIMIENTO
  // =====================================

  eliminarMovimiento(id: number): void {
    const indice = this.movimientos.findIndex((movimiento) => movimiento.id === id);

    if (indice === -1) {
      return;
    }

    const movimiento = this.movimientos[indice];

    this.movimientos = this.movimientos.filter((m) => m.id !== id);

    // Si se estaba editando esa fila, descartar la edición
    if (this.editando?.id === id) {
      this.editando = null;
    }

    // Si se elimina el movimiento recién añadido, limpiar su animación
    if (this.ultimoMovimientoId === id) {
      this.ultimoMovimientoId = null;
      this.ultimoTipoMovimiento = null;
    }

    this.actualizarGraficas();

    // Guardarlo para poder deshacer y avisar con un toast
    this.movimientoEliminado = { movimiento, indice };
    this.mostrarToast(movimiento, 'eliminado');
  }

  // =====================================
  // EDICIÓN RÁPIDA (DOBLE CLIC EN EL HISTORIAL)
  // =====================================

  editando: { id: number; campo: CampoEditable } | null = null;

  valorEdicion: string | number | null = '';

  // El input de edición se enfoca y se selecciona en cuanto aparece en el DOM
  @ViewChild('campoEdicion')
  set campoEdicion(elemento: ElementRef<HTMLInputElement> | undefined) {
    if (elemento) {
      // ngModel escribe el valor en una microtarea: se espera a que termine para seleccionarlo
      setTimeout(() => {
        elemento.nativeElement.focus();
        elemento.nativeElement.select();
      });
    }
  }

  estaEditando(id: number, campo: CampoEditable): boolean {
    return this.editando?.id === id && this.editando.campo === campo;
  }

  iniciarEdicion(movimiento: Movimiento, campo: CampoEditable): void {
    this.editando = { id: movimiento.id, campo };
    this.valorEdicion = movimiento[campo];
  }

  cancelarEdicion(): void {
    this.editando = null;
  }

  // Se llama con Enter y también al perder el foco; si no hay edición activa no hace nada
  guardarEdicion(): void {
    const edicion = this.editando;

    if (!edicion) {
      return;
    }

    this.editando = null;

    const original = this.movimientos.find((m) => m.id === edicion.id);

    if (!original) {
      return;
    }

    let cambios: Partial<Movimiento>;

    if (edicion.campo === 'concepto') {
      const concepto = String(this.valorEdicion ?? '').trim();

      // Un concepto vacío o igual al anterior se descarta
      if (concepto === '' || concepto === original.concepto) {
        return;
      }

      cambios = { concepto };
    } else {
      const cantidad = Number(this.valorEdicion);

      // Una cantidad inválida o igual a la anterior se descarta
      if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad === original.cantidad) {
        return;
      }

      cambios = { cantidad };
    }

    this.movimientos = this.movimientos.map((m) => (m.id === edicion.id ? { ...m, ...cambios } : m));

    this.actualizarGraficas();
  }

  // =====================================
  // DESHACER ELIMINACIÓN
  // =====================================

  deshacerEliminacion(): void {
    const pendiente = this.movimientoEliminado;

    if (!pendiente) {
      return;
    }

    this.movimientoEliminado = null;

    // Recuperar el movimiento en su posición original
    const indice = Math.min(pendiente.indice, this.movimientos.length);

    this.movimientos = [
      ...this.movimientos.slice(0, indice),
      pendiente.movimiento,
      ...this.movimientos.slice(indice),
    ];

    this.ocultarToast();
    this.iniciarAnimacionInsercion(pendiente.movimiento);
    this.actualizarGraficas();
  }

  // =====================================
  // NOTIFICACIÓN FLOTANTE
  // =====================================

  private mostrarToast(movimiento: Movimiento, modo: ModoToast = 'registro'): void {
    // Si ya había un toast visible se vuelve a montar para reiniciar sus animaciones
    if (this.mostrarNotificacion) {
      this.mostrarNotificacion = false;
      this.cdr.detectChanges();
    }

    if (modo === 'registro') {
      this.movimientoEliminado = null;
    }

    this.notificacionModo = modo;
    this.notificacionTipo = movimiento.tipo;
    this.notificacionConcepto = movimiento.concepto;
    this.notificacionCantidad = movimiento.cantidad;

    this.ocultandoNotificacion = false;
    this.toastPausado = false;
    this.mostrarNotificacion = true;

    // El toast de "eliminado" dura más para dar tiempo a deshacer
    this.programarToast(modo === 'eliminado' ? 4500 : 3000);
  }

  // Programa la salida y la retirada del toast cuando falten `restante` ms
  private programarToast(restante: number): void {
    this.limpiarTemporizadoresToast();

    this.finToast = Date.now() + restante;

    // Inicia animación de salida 0.4 s antes de retirarlo
    this.temporizadorSalidaToast = setTimeout(
      () => {
        this.ocultandoNotificacion = true;
        this.cdr.detectChanges();
      },
      Math.max(0, restante - 400),
    );

    // Elimina el toast del DOM
    this.temporizadorNotificacion = setTimeout(() => {
      if (this.notificacionModo === 'eliminado') {
        this.movimientoEliminado = null;
      }

      this.mostrarNotificacion = false;
      this.ocultandoNotificacion = false;
      this.toastPausado = false;
      this.cdr.detectChanges();
    }, restante);
  }

  // =====================================
  // PAUSAR EL TOAST AL PASAR EL RATÓN
  // =====================================

  pausarToast(): void {
    // Si ya está saliendo no hay nada que pausar
    if (!this.mostrarNotificacion || this.ocultandoNotificacion || this.toastPausado) {
      return;
    }

    this.restanteToast = Math.max(0, this.finToast - Date.now());
    this.limpiarTemporizadoresToast();
    this.toastPausado = true;
  }

  reanudarToast(): void {
    if (!this.toastPausado) {
      return;
    }

    this.toastPausado = false;

    if (this.mostrarNotificacion) {
      // Mínimo 0.4 s para que siempre se vea la animación de salida
      this.programarToast(Math.max(this.restanteToast, 400));
    }
  }

  private ocultarToast(): void {
    this.limpiarTemporizadoresToast();
    this.mostrarNotificacion = false;
    this.ocultandoNotificacion = false;
    this.toastPausado = false;
  }

  private limpiarTemporizadoresToast(): void {
    if (this.temporizadorNotificacion) {
      clearTimeout(this.temporizadorNotificacion);
    }

    if (this.temporizadorSalidaToast) {
      clearTimeout(this.temporizadorSalidaToast);
    }
  }

  // =====================================
  // INICIALIZAR GRÁFICAS
  // =====================================

  ngAfterViewInit(): void {
    this.vistasPreparadas = true;
    this.crearGraficas();

    // Las gráficas se dibujan en canvas: al terminar de cargar la fuente
    // web hay que redibujarlas para que el texto use la tipografía correcta.
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.ready.then(() => {
        this.chartBalance?.update('none');
        this.chartDistribucion?.update('none');
      });
    }
  }

  // =====================================
  // DEGRADADO DE LAS BARRAS
  // =====================================

  private degradadoBarra(contexto: ScriptableContext<'bar'>): CanvasGradient | string {
    const tipo = this.movimientosFiltrados[contexto.dataIndex]?.tipo;
    const rgb = tipo === 'ingreso' ? COLOR_INGRESO : COLOR_GASTO;
    // Chart.js añade `element` al contexto en tiempo de ejecución
    const barra = (contexto as unknown as { element?: BarElement }).element;

    if (!barra) {
      return `rgb(${rgb})`;
    }

    const { y, base } = barra.getProps(['y', 'base'], true);

    // Mientras Chart.js calcula el layout, las coordenadas aún no existen
    // (undefined / NaN) y createLinearGradient lanzaría una excepción.
    if (!Number.isFinite(y) || !Number.isFinite(base)) {
      return `rgb(${rgb})`;
    }

    const degradado = contexto.chart.ctx.createLinearGradient(0, Number(y), 0, Number(base));

    degradado.addColorStop(0, `rgba(${rgb}, 1)`);
    degradado.addColorStop(1, `rgba(${rgb}, 0.45)`);

    return degradado;
  }

  // =====================================
  // TEXTO CENTRAL DEL DONUT
  // =====================================

  private obtenerResumenCentro(): { titulo: string; valor: number } {
    switch (this.filtroActual) {
      case 'ingreso':
        return { titulo: 'Total ingresos', valor: this.totalIngresos };
      case 'gasto':
        return { titulo: 'Total gastos', valor: this.totalGastos };
      default:
        return { titulo: 'Balance', valor: this.balance };
    }
  }

  // =====================================
  // OBTENER DATOS DE LAS GRÁFICAS
  // =====================================

  private obtenerDatosGrafica() {
    const movimientos = this.movimientosFiltrados;

    return {
      etiquetas: movimientos.map((m) =>
        this.filtroActual === 'todos' ? `${m.concepto} (${m.tipo})` : m.concepto,
      ),
      cantidades: movimientos.map((m) => m.cantidad),
      colores: movimientos.map((m) => (m.tipo === 'ingreso' ? '#00d6a3' : '#ff5277')),
    };
  }

  // =====================================
  // COLORES DEL TEMA
  // =====================================

  private obtenerColoresTema() {
    return {
      texto: this.modoOscuro ? '#f1f5f9' : '#172033',
      textoSecundario: this.modoOscuro ? '#a0aec0' : '#7c879b',
      rejilla: this.modoOscuro ? '#29344b' : '#e8edf4',
      fondo: this.modoOscuro ? '#172033' : '#ffffff',
    };
  }

  // =====================================
  // CREAR GRÁFICAS
  // =====================================

  crearGraficas(): void {
    if (!this.graficaBalance || !this.graficaDistribucion) {
      return;
    }

    const datos = this.obtenerDatosGrafica();
    const tema = this.obtenerColoresTema();

    this.chartBalance?.destroy();
    this.chartDistribucion?.destroy();

    // GRÁFICA DE BARRAS
    this.chartBalance = new Chart<'bar', number[], string>(this.graficaBalance.nativeElement, {
      type: 'bar',
      data: {
        labels: datos.etiquetas,
        datasets: [
          {
            label: 'Cantidad (€)',
            data: datos.cantidades,
            backgroundColor: (contexto) => this.degradadoBarra(contexto),
            borderRadius: 8,
            maxBarThickness: 55,
            barThickness: 'flex',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 900,
          easing: 'easeOutQuart',
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const valor = Number(context.parsed.y ?? 0);
                return valor.toLocaleString('es-ES', {
                  style: 'currency',
                  useGrouping: true,
                  currency: 'EUR',
                });
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: tema.textoSecundario,
              font: { family: FUENTE },
              callback: (value) => `${value} €`,
            },
            // En Chart.js 4 el trazo de la rejilla se configura en `border.dash`
            border: {
              display: false,
              dash: [4, 4],
            },
            grid: {
              color: tema.rejilla,
            },
          },
          x: {
            ticks: {
              color: tema.textoSecundario,
              font: { family: FUENTE },
              autoSkip: false,
              maxRotation: 45,
              minRotation: 0,
            },
            grid: {
              display: false,
            },
          },
        },
      },
    });

    // GRÁFICA CIRCULAR
    this.chartDistribucion = new Chart<'doughnut', number[], string>(
      this.graficaDistribucion.nativeElement,
      {
        type: 'doughnut',
        data: {
          labels: datos.etiquetas,
          datasets: [
            {
              data: datos.cantidades,
              backgroundColor: datos.colores,
              borderWidth: 2,
              borderColor: tema.fondo,
              hoverOffset: 12,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          animation: {
            animateRotate: true,
            animateScale: true,
            duration: 1000,
          },
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                color: tema.texto,
                padding: 14,
                usePointStyle: true,
                pointStyle: 'circle',
                boxWidth: 8,
                boxHeight: 8,
                font: {
                  family: FUENTE,
                  size: 11,
                },
              },
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const cantidad = Number(context.parsed ?? 0);
                  return `${context.label}: ${cantidad.toLocaleString('es-ES', {
                    style: 'currency',
                    useGrouping: true,
                    currency: 'EUR',
                  })}`;
                },
              },
            },
          },
        },
        plugins: [
          {
            // Texto en el hueco central del donut con el total filtrado
            id: 'textoCentral',
            afterDraw: (chart) => {
              const { ctx, chartArea } = chart;

              if (!chartArea || this.movimientosFiltrados.length === 0) {
                return;
              }

              const resumen = this.obtenerResumenCentro();
              const colores = this.obtenerColoresTema();
              const x = (chartArea.left + chartArea.right) / 2;
              const y = (chartArea.top + chartArea.bottom) / 2;

              ctx.save();
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';

              ctx.fillStyle = colores.textoSecundario;
              ctx.font = `500 11px ${FUENTE}`;
              ctx.fillText(resumen.titulo, x, y - 12);

              ctx.fillStyle = colores.texto;
              ctx.font = `800 19px ${FUENTE}`;
              ctx.fillText(
                resumen.valor.toLocaleString('es-ES', {
                  style: 'currency',
                  useGrouping: true,
                  currency: 'EUR',
                }),
                x,
                y + 10,
              );

              ctx.restore();
            },
          },
        ],
      },
    );
  }

  // =====================================
  // ACTUALIZAR GRÁFICAS
  // =====================================

  actualizarGraficas(): void {
    if (!this.vistasPreparadas) {
      return;
    }

    const datos = this.obtenerDatosGrafica();

    if (this.chartBalance) {
      this.chartBalance.data.labels = datos.etiquetas;
      this.chartBalance.data.datasets[0].data = datos.cantidades;
      this.chartBalance.update();
    }

    if (this.chartDistribucion) {
      this.chartDistribucion.data.labels = datos.etiquetas;
      this.chartDistribucion.data.datasets[0].data = datos.cantidades;
      this.chartDistribucion.data.datasets[0].backgroundColor = datos.colores;
      this.chartDistribucion.update();
    }
  }

  // =====================================
  // DESTRUIR COMPONENTE
  // =====================================

  ngOnDestroy(): void {
    this.chartBalance?.destroy();
    this.chartDistribucion?.destroy();

    if (this.temporizadorNotificacion) {
      clearTimeout(this.temporizadorNotificacion);
    }

    if (this.temporizadorSalidaToast) {
      clearTimeout(this.temporizadorSalidaToast);
    }

    if (this.temporizadorAnimacion) {
      clearTimeout(this.temporizadorAnimacion);
    }

    if (this.temporizadorInsercion) {
      clearTimeout(this.temporizadorInsercion);
    }
  }
}
