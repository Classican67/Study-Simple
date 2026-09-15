/**
 * Script en ligne, exécuté pendant l'analyse du HTML — avant le premier rendu.
 *
 * React avertit en développement dès qu'un rendu **côté client** produit une
 * balise `<script>` : elle n'y serait jamais exécutée. Cela arrive au script du
 * thème chaque fois que la racine est rendue à nouveau dans le navigateur, par
 * exemple quand une erreur serveur fait reprendre le rendu depuis la racine.
 *
 * Solution recommandée par Next (guide « Preventing flash before hydration ») :
 * `text/javascript` au serveur, `text/plain` au client — le navigateur a déjà
 * exécuté la version du serveur, et `suppressHydrationWarning` fait accepter la
 * différence de type.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
