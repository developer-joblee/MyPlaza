-- =============================================================================
-- toGether / MyPlaza — 0011_soundboard_wav
-- O bucket do soundboard passa a aceitar `audio/wav`.
--
-- Aplicação manual, depois de 0010 (ver `db/README.md`).
--
-- POR QUE EXISTE: o corte automático de áudio (`client/src/soundboard/trim.ts`)
-- reescreve em WAV o arquivo que passou de 5s — é o único formato que dá para
-- gerar no navegador sem dependência nova e sem gravar em tempo real. A `0010`
-- criou o bucket com uma whitelist que não tinha wav, e o `insert into
-- storage.buckets` dela é `on conflict do nothing`: reaplicar a `0010` **não**
-- corrige um bucket que já existe.
--
-- O sintoma, para quem topar com ele: o upload falha com
-- `mime type audio/wav is not supported` no log do servidor, e a tela mostra o
-- erro genérico — o arquivo está certo, a whitelist do bucket é que está velha.
--
-- Idempotente. Se o bucket não existir (a `0010` não rodou), o update afeta 0
-- linhas e não falha — a `0010` já o cria com a lista correta.
-- =============================================================================

update storage.buckets
   set allowed_mime_types = array[
         'audio/mpeg',
         'audio/ogg',
         'audio/webm',
         'audio/mp4',
         'audio/aac',
         -- o cliente reescreve em wav o que precisou cortar; mono, 22,05 kHz e
         -- no máximo 5s, ele fica em ~215 KB, dentro do file_size_limit
         'audio/wav'
       ]
 where id = 'soundboard';
