-- Corre esto UNA sola vez en Supabase > SQL Editor > Run.
-- Agrega las columnas donde se guarda qué materia, grados y secciones maneja cada docente.
-- Sin esto, el registro de docentes seguirá funcionando (el código no se rompe),
-- pero esos tres datos no se guardarán todavía.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS teacher_subject_id text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS teacher_grades jsonb DEFAULT '[]'::jsonb;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS teacher_sections jsonb DEFAULT '[]'::jsonb;

-- Para el panel de Administración: aprobar docentes nuevos y poder deshabilitar cuentas.
-- OJO: el DEFAULT true en "approved" es solo para que las cuentas YA EXISTENTES no queden
-- bloqueadas de un momento a otro. Los docentes que se registren de ahora en adelante
-- quedan en false (pendientes) automáticamente por el propio código de la app.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS approved boolean DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS disabled boolean DEFAULT false;

-- Para poder entrar como Administración, no hay registro público (por seguridad).
-- Crea o usa una cuenta normal y luego, aquí mismo, ejecuta (cambiando el correo):
-- UPDATE profiles SET role='admin' WHERE id=(SELECT id FROM auth.users WHERE email='correo@ejemplo.com');
