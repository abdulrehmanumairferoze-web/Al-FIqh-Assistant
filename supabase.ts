
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rkuktqieftjzscxxbvjr.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrdWt0cWllZnRqenNjeHhidmpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0MjE2NzIsImV4cCI6MjA4Mjk5NzY3Mn0.iAxe1bOJMgaWzDbFttCCrukrs1D0f7OIiVDgEj1Ddsw';

export const supabase = createClient(supabaseUrl, supabaseKey);
