import { Component, computed, input } from '@angular/core';

/**
 * Muestra un importe en euros con formato español (1.500,00 €).
 * En modo "destacado" la parte entera va grande y en negrita, y los
 * céntimos + el símbolo € más pequeños y con menor opacidad.
 */
@Component({
  selector: 'app-importe',
  host: { '[class.destacado]': 'destacado()' },
  template: `<span class="entero">{{ partes().entero }}</span><span class="resto">{{ partes().resto }}</span>`,
  styles: `
    :host {
      font-variant-numeric: tabular-nums;
    }

    :host(.destacado) .entero {
      font-weight: 800;
    }

    :host(.destacado) .resto {
      margin-left: 1px;
      font-size: 0.65em;
      font-weight: 600;
      opacity: 0.6;
    }
  `,
})
export class Importe {
  valor = input.required<number>();
  destacado = input(false);

  partes = computed(() => {
    const valor = this.valor();
    const [entero, decimales] = Math.abs(valor).toFixed(2).split('.');
    const negativo = valor < 0 && Number(entero + '.' + decimales) > 0;

    return {
      entero: (negativo ? '-' : '') + entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.'),
      resto: `,${decimales} €`,
    };
  });
}
